#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
通用卡证检测器：基于 PP-OCRv6 det 模型输出的文本框坐标做空间聚类，
把一张图片里可能混杂的多张卡证（如合影）分割成独立区域。
"""

from typing import Dict, List

import numpy as np
from sklearn.cluster import DBSCAN

from src.core.logger import logger

# 文本框数少于该阈值时，聚类不稳定，直接当作单区域处理
MIN_BOXES_FOR_CLUSTERING = 3

# DBSCAN 邻域半径：不能用固定像素值——手机照片分辨率差异很大（几百到几千像素），
# 固定阈值在高分辨率照片上会把同一张卡的每一行文字拆成独立簇。
# 改用"本图文本框高度的中位数"作为分辨率无关的基准单位，乘以经验系数得到聚类半径：
# 同一张卡内的行间距通常是文字高度的 1~2 倍，不同卡证之间的物理间隙通常是文字高度的数倍以上。
EPS_HEIGHT_MULTIPLIER = 2.5
MIN_EPS_PIXELS = 20.0  # 极端小图兜底，避免中位数过小导致每个文本框自成一簇
CLUSTER_MIN_SAMPLES = 2

# 裁剪区域时的边缘留白，避免边界文字被切掉
CROP_PADDING = 10


class UniversalCardDetector:
    """通用多卡证检测器（装了就跑，无外部模型依赖，复用现有 det 模型输出）"""

    @staticmethod
    def detect_regions(ocr_results: list, img_np: np.ndarray) -> List[Dict]:
        """
        对完整图 OCR 结果做文本框聚类，划分出卡证区域

        Args:
            ocr_results: RapidOCR 返回的 [(box, text, score), ...]
            img_np: 原始图像(RGB)

        Returns:
            [{"bbox": [x0,y0,x1,y1], "cropped": np.ndarray, "texts": List[str]}, ...]
            文本框数 < MIN_BOXES_FOR_CLUSTERING 时，直接返回整图作为单一区域
        """
        if not ocr_results:
            return []

        if len(ocr_results) < MIN_BOXES_FOR_CLUSTERING:
            return [UniversalCardDetector._whole_image_region(ocr_results, img_np)]

        centers = []
        heights = []
        for item in ocr_results:
            box = item[0]
            cx = sum(p[0] for p in box) / 4
            cy = sum(p[1] for p in box) / 4
            centers.append([cx, cy])
            ys = [p[1] for p in box]
            heights.append(max(ys) - min(ys))

        centers_np = np.array(centers)
        text_height = float(np.median(heights)) if heights else MIN_EPS_PIXELS
        eps = max(text_height * EPS_HEIGHT_MULTIPLIER, MIN_EPS_PIXELS)

        clustering = DBSCAN(eps=eps, min_samples=CLUSTER_MIN_SAMPLES).fit(centers_np)
        labels = clustering.labels_
        logger.info(f"卡证检测：文本框中位高度 {text_height:.1f}px, 聚类半径 eps={eps:.1f}px")

        cluster_ids = sorted(set(labels) - {-1})
        if not cluster_ids:
            # 全是噪声点（DBSCAN 没能聚出任何簇），退回整图单区域
            logger.info("卡证检测: DBSCAN 未聚出有效簇，按整图单区域处理")
            return [UniversalCardDetector._whole_image_region(ocr_results, img_np)]

        # 分组：每个簇收集自己的文本框下标；噪声点先记下待分配
        cluster_index_map: Dict[int, List[int]] = {cid: [] for cid in cluster_ids}
        for i, label in enumerate(labels):
            if label != -1:
                cluster_index_map[label].append(i)

        # 噪声点分配到最近的簇（按中心点到簇质心的距离），而不是丢给"面积最大的区域"——
        # 否则噪声点的文本框不会被计入该区域的裁剪范围，二次 OCR 时其文字必然缺失
        noise_indices = [i for i, label in enumerate(labels) if label == -1]
        if noise_indices:
            cluster_centroids = {
                cid: centers_np[idxs].mean(axis=0) for cid, idxs in cluster_index_map.items()
            }
            for i in noise_indices:
                nearest_cid = min(cluster_centroids, key=lambda cid: np.linalg.norm(centers_np[i] - cluster_centroids[cid]))
                cluster_index_map[nearest_cid].append(i)

        regions = []
        h, w = img_np.shape[:2]
        for cluster_id in cluster_ids:
            indices = cluster_index_map[cluster_id]
            cluster_boxes = [ocr_results[i][0] for i in indices]
            cluster_texts = [ocr_results[i][1] for i in indices]

            all_points = np.concatenate([np.array(b) for b in cluster_boxes])
            x_min, y_min = all_points.min(axis=0)
            x_max, y_max = all_points.max(axis=0)

            x0 = max(0, int(x_min) - CROP_PADDING)
            y0 = max(0, int(y_min) - CROP_PADDING)
            x1 = min(w, int(x_max) + CROP_PADDING)
            y1 = min(h, int(y_max) + CROP_PADDING)

            regions.append({
                "bbox": [x0, y0, x1, y1],
                "cropped": img_np[y0:y1, x0:x1],
                "texts": cluster_texts,
            })

        return regions

    @staticmethod
    def _whole_image_region(ocr_results: list, img_np: np.ndarray) -> Dict:
        h, w = img_np.shape[:2]
        return {
            "bbox": [0, 0, w, h],
            "cropped": img_np,
            "texts": [item[1] for item in ocr_results],
        }
