#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
OCR Worker：线程池处理队列中的 OCR 任务
使用内存队列，不依赖 Huey 和 SQLite

主循环采用"探测→分诊→合并"两阶段：
1. 探测：对整张上传图片跑一次 OCR，拿到全部文本框
2. 分诊：用 UniversalCardDetector 对文本框聚类，判断图里有几张卡证区域
   - 1 个区域：直接对整图 OCR 结果分类识别（等价于原有单卡路径，无额外开销）
   - N 个区域（N>=2，合影场景）：逐个裁剪区域，各自二次 OCR + 识别
3. 合并：把每个区域产出的 DetectedCard 汇总进该 subtask 的 cards 列表
"""

import io
import base64
import numpy as np
from typing import Optional
from PIL import Image
from threading import Thread
from src.core.logger import logger
from src.core.config import MODEL_DIR, MODELS_CONFIG, REC_CHAR_DICT_PATH
from src.core.memory_store import memory_store, OCRTask, SubTaskResult, DetectedCard
from src.ocr.ocr_engine import ModelManagerSrv
from src.ocr.card_detector import UniversalCardDetector
from src.ocr.card_registry import classify_card_by_texts, get_signature, detect_mixed_types_in_texts

# Worker 进程本地的延迟单例模式加载
_ocr_worker_engine = None


def get_ocr_worker_engine():
    """延迟载入：在任务进入消费线程时，显式拉取 Hugging Face 的 ONNX 路径物理载入"""
    global _ocr_worker_engine
    if _ocr_worker_engine is None:
        ModelManagerSrv.check_and_download_models()

        from rapidocr_onnxruntime import RapidOCR

        det_path = str(MODEL_DIR / MODELS_CONFIG["det"]["local_filename"])
        rec_path = str(MODEL_DIR / MODELS_CONFIG["rec"]["local_filename"])

        logger.info("系统检测到 Hugging Face 权重完备，正在进行纯离线引擎注入...")

        _ocr_worker_engine = RapidOCR(
            det_model_path=det_path,
            rec_model_path=rec_path,
            rec_keys_path=str(REC_CHAR_DICT_PATH)
        )
        logger.info("本地 RapidOCR 推理引擎基于 Hugging Face 源初始化成功！")
    return _ocr_worker_engine


def _encode_cropped_image(img_np: np.ndarray) -> Optional[str]:
    """将裁剪后的图像编码为 base64 JPEG 字符串，用于前端展示该卡证在原图中的区域"""
    if img_np is None or img_np.size == 0:
        return None
    img_pil = Image.fromarray(img_np)
    buffer = io.BytesIO()
    img_pil.save(buffer, format="JPEG", quality=85)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _classify_and_parse(ocr_out: list, cropped_img_np: np.ndarray = None) -> DetectedCard:
    """对一批 OCR 结果分类并调用对应 parse 函数，产出一张 DetectedCard

    Args:
        cropped_img_np: 该卡证在原图中对应的裁剪区域，用于前端展示；单卡场景可传整图
    """
    cropped_b64 = _encode_cropped_image(cropped_img_np) if cropped_img_np is not None else None

    if not ocr_out:
        return DetectedCard(card_type="unknown", raw_text=[], cropped_image_b64=cropped_b64)

    texts = [line[1] for line in ocr_out]
    card_type = classify_card_by_texts(texts)

    if card_type == "unknown":
        return DetectedCard(card_type="unknown", raw_text=texts, cropped_image_b64=cropped_b64)

    signature = get_signature(card_type)
    data = signature.parse_func(ocr_out)
    return DetectedCard(card_type=card_type, data=data, cropped_image_b64=cropped_b64)


def _detect_and_parse_cards(engine_instance, img_np: np.ndarray) -> list:
    """探测→分诊→合并：返回该图片检测出的全部 DetectedCard 列表

    关键设计：
    1. 聚类只负责粗分"信息块"（文本框空间聚集）
    2. 对每个信息块做分类检测，如果一个信息块内同时匹配多种卡证类型 → 说明这个块混杂了多张卡，
       需要按 OCR 文本框逐行分配到不同类型（按文本框各自最匹配的类型拆分）
    3. 拆分后再按类型合并裁剪范围，各自二次 OCR + parse
    """
    ocr_out, _ = engine_instance(img_np)

    if not ocr_out:
        return []

    # 第一步：全局检测是否混杂多种卡证类型
    global_mixed_types = detect_mixed_types_in_texts([item[1] for item in ocr_out])

    regions = UniversalCardDetector.detect_regions(ocr_out, img_np)

    # 第二步：根据全局类型数和区域数决定策略
    if len(global_mixed_types) <= 1:
        # 全局只有 0/1 种已知类型 → 单卡场景（即使 DBSCAN 聚出了多个块，也是同一张卡内部的稀疏分布）
        logger.info(f"全局只对应 {len(global_mixed_types) or 0} 种已知卡证类型，按单卡处理")
        return [_classify_and_parse(ocr_out, img_np)]

    # 全局混杂 ≥2 种类型 → 需要拆分
    if len(regions) <= 1:
        # 单个大簇混杂多类型 → 按文本框逐行分配
        logger.info(f"单个聚类区域内检测到 {len(global_mixed_types)} 种卡证类型混杂，按文本框逐行分配")
        return _split_and_parse_mixed_region(engine_instance, ocr_out, img_np, global_mixed_types)

    # 多区域且全局混杂多类型 → 检查每个区域是否内部也混杂，混杂的二次拆分
    refined_regions = []
    for region in regions:
        region_mixed_types = detect_mixed_types_in_texts(region["texts"])
        if len(region_mixed_types) <= 1:
            region["card_type"] = classify_card_by_texts(region["texts"])
            refined_regions.append(region)
        else:
            # 该区域内混杂多种类型
            logger.info(f"信息块混杂 {len(region_mixed_types)} 种类型，拆分")
            box_indices = []
            for text in region["texts"]:
                for i, item in enumerate(ocr_out):
                    if item[1] == text:
                        box_indices.append(i)
                        break
            sub_regions = _split_boxes_by_type([ocr_out[i] for i in box_indices], img_np, region_mixed_types)
            if not sub_regions:
                # 拆分失败（缺少种子框），保留原区域
                region["card_type"] = classify_card_by_texts(region["texts"])
                refined_regions.append(region)
            else:
                refined_regions.extend(sub_regions)

    known_types = {r["card_type"] for r in refined_regions if r["card_type"] != "unknown"}

    if len(known_types) <= 1:
        logger.info(f"拆分后只对应 {len(known_types) or 0} 种已知卡证类型，按单卡处理")
        return [_classify_and_parse(ocr_out, img_np)]

    logger.info(f"检测到 {len(known_types)} 种已知卡证类型，逐类型合并区域二次识别")
    cards = []
    h, w = img_np.shape[:2]
    for card_type in sorted(known_types):
        type_regions = [r for r in refined_regions if r["card_type"] == card_type]
        x0 = max(0, min(r["bbox"][0] for r in type_regions))
        y0 = max(0, min(r["bbox"][1] for r in type_regions))
        x1 = min(w, max(r["bbox"][2] for r in type_regions))
        y1 = min(h, max(r["bbox"][3] for r in type_regions))
        cropped = img_np[y0:y1, x0:x1]

        signature = get_signature(card_type)
        enhanced = signature.preprocess_func(cropped) if signature.preprocess_func else cropped

        region_ocr_out, _ = engine_instance(enhanced)
        cards.append(_classify_and_parse(region_ocr_out, cropped))

    # 多卡场景下的零散 unknown 区域（如背景噪声文字）静默丢弃，不产出 unknown 卡片——
    # 因为已经成功识别出 ≥2 张已知卡证，零散文字大概率是背景噪声而非有效信息
    # （单卡场景下的 unknown 仍会保留，因为那可能是唯一的识别结果）

    return cards


def _split_boxes_by_type(ocr_items: list, img_np: np.ndarray, known_types: list) -> list:
    """把一批 OCR 文本框按已知类型分组（通过文本框之间的空间就近原则）

    Args:
        ocr_items: [(box, text, score), ...]
        img_np: 原图
        known_types: 该区域内检测到的已知卡证类型列表（如 ['idcard_front', 'bankcard']）

    思路：
    1. 先找出每个已知类型的"种子框"（该框的文本单独分类时能命中该类型）
    2. 其余文本框按空间距离归到最近的种子框所属类型
    """
    centers = []
    for item in ocr_items:
        box = item[0]
        cx = sum(p[0] for p in box) / 4
        cy = sum(p[1] for p in box) / 4
        centers.append([cx, cy])
    centers_np = np.array(centers)

    # 找种子框
    type_seeds = {ct: [] for ct in known_types}
    unassigned_indices = []
    for i, item in enumerate(ocr_items):
        text = item[1]
        matched = classify_card_by_texts([text])
        if matched in known_types:
            type_seeds[matched].append(i)
        else:
            unassigned_indices.append(i)

    # 如果某个已知类型没有种子框（所有该类型的关键词都分散在多个文本框里，单行无法命中），
    # 退化为整图单卡处理（无法可靠拆分）
    if any(len(seeds) == 0 for seeds in type_seeds.values()):
        logger.warning(f"混杂区域内某已知类型缺少种子框，无法可靠拆分，退回整图识别")
        return []

    # 未分配的文本框按最近种子框的类型归类
    box_to_type = {}
    for ct, seed_indices in type_seeds.items():
        for i in seed_indices:
            box_to_type[i] = ct

    for i in unassigned_indices:
        min_dist = float('inf')
        nearest_type = None
        for ct, seed_indices in type_seeds.items():
            for seed_i in seed_indices:
                dist = np.linalg.norm(centers_np[i] - centers_np[seed_i])
                if dist < min_dist:
                    min_dist = dist
                    nearest_type = ct
        box_to_type[i] = nearest_type

    # 按类型分组构建 region
    type_to_boxes = {ct: [] for ct in known_types}
    for i, item in enumerate(ocr_items):
        ct = box_to_type[i]
        type_to_boxes[ct].append((item[0], item[1]))

    h, w = img_np.shape[:2]
    regions = []
    for card_type, boxes_texts in type_to_boxes.items():
        if not boxes_texts:
            continue
        boxes = [bt[0] for bt in boxes_texts]
        texts = [bt[1] for bt in boxes_texts]
        all_points = np.concatenate([np.array(b) for b in boxes])
        x_min, y_min = all_points.min(axis=0)
        x_max, y_max = all_points.max(axis=0)
        x0 = max(0, int(x_min) - 10)
        y0 = max(0, int(y_min) - 10)
        x1 = min(w, int(x_max) + 10)
        y1 = min(h, int(y_max) + 10)
        regions.append({
            "bbox": [x0, y0, x1, y1],
            "cropped": img_np[y0:y1, x0:x1],
            "texts": texts,
            "card_type": card_type,
        })
    return regions


def _split_and_parse_mixed_region(engine_instance, ocr_out: list, img_np: np.ndarray, mixed_types: list) -> list:
    """单区域混杂多类型时的专用路径：把 OCR 文本框按各自最佳匹配类型分组，然后各自裁剪二次识别"""
    sub_regions = _split_boxes_by_type(ocr_out, img_np, mixed_types)
    if not sub_regions:
        # 拆分失败，退回整图单卡
        return [_classify_and_parse(ocr_out, img_np)]

    cards = []
    for region in sub_regions:
        signature = get_signature(region["card_type"])
        enhanced = signature.preprocess_func(region["cropped"]) if signature.preprocess_func else region["cropped"]
        region_ocr_out, _ = engine_instance(enhanced)
        cards.append(_classify_and_parse(region_ocr_out, region["cropped"]))
    return cards


def ocr_worker_thread():
    """Worker 线程：从队列取任务，执行 OCR，写入内存"""
    logger.info("OCR Worker 线程启动")

    while True:
        try:
            task: OCRTask = memory_store.ocr_queue.get()
            logger.info(f"处理任务: {task.filename} (batch={task.batch_id}, row={task.row_index})")

            # 更新状态为 processing
            memory_store.update_subtask_status(task.batch_id, task.subtask_id, "processing")

            status = "completed"
            cards = []

            try:
                raw_bytes = base64.b64decode(task.image_b64)
                image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
                img_np = np.array(image)

                engine_instance = get_ocr_worker_engine()
                cards = _detect_and_parse_cards(engine_instance, img_np)

                if not cards:
                    status = "failed"

            except Exception as e:
                status = "failed"
                fallback_b64 = _encode_cropped_image(img_np) if 'img_np' in locals() else None
                cards = [DetectedCard(card_type="unknown", data={"解析失败": str(e)}, cropped_image_b64=fallback_b64)]
                logger.error(f"识别异常: {task.filename} - {str(e)}", exc_info=True)

            # 写入内存
            result = SubTaskResult(
                subtask_id=task.subtask_id,
                row_index=task.row_index,
                slot_index=task.slot_index,
                filename=task.filename,
                status=status,
                cards=cards
            )
            memory_store.add_result(task.batch_id, result)

            logger.info(f"任务完成: {task.filename} (status={status}, cards={len(cards)})")

        except Exception as e:
            logger.error(f"Worker 线程异常: {str(e)}", exc_info=True)


def start_workers(num_workers: int = 2):
    """启动多个 worker 线程"""
    for i in range(num_workers):
        thread = Thread(target=ocr_worker_thread, daemon=True, name=f"OCRWorker-{i}")
        thread.start()
        logger.info(f"OCR Worker 线程 {i} 已启动")
