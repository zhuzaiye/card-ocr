#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
import shutil
from huggingface_hub import hf_hub_download
from mrz.checker.td3 import TD3CodeChecker
from src.core.logger import logger
from src.core.config import MODEL_DIR, MODELS_CONFIG
from src.core.excepts import AppException, ErrorCode


class ModelManagerSrv:
    """
    Hugging Face PaddlePaddle 官方源权重文件管理服务
    """

    @staticmethod
    def check_and_download_models():
        logger.info("启动基于 Hugging Face 官方 SDK 的 PP-OCRv6 权重环境自检...")

        for key, cfg in MODELS_CONFIG.items():
            target_path = MODEL_DIR / cfg["local_filename"]

            if not target_path.exists():
                logger.warning(
                    f"检测到本地缺失模型文件: {cfg['local_filename']}，准备从 Hugging Face 库自动拉取..."
                )
                try:
                    # 1. 触发官方 SDK 弹性下载（自带原生 tqdm 进度条，支持环境变量代理和断点续传）
                    temp_downloaded_path = hf_hub_download(
                        repo_id=cfg["repo_id"],
                        filename=cfg["filename"],
                        local_dir=MODEL_DIR,  # 指定直接落盘目录
                        local_dir_use_symlinks=
                        False,  # 物理写入，避免在部分 Windows 环境下由于软链接权限不足引发的错误
                    )

                    # 2. 将通用的 'inference.onnx' 重命名为系统可区分的本地专有名称
                    shutil.move(temp_downloaded_path, target_path)
                    logger.info(
                        f"Hugging Face 官方权重 {cfg['local_filename']} 物理落盘并校验完成。"
                    )

                except Exception as sdk_err:
                    logger.critical(
                        f"通过 Hugging Face SDK 拉取权重失败: {str(sdk_err)}")

                    # 友好引导异常抛出
                    raise AppException(
                        code=ErrorCode.OCR_ENGINE_ERROR,
                        message=
                        (f"无法通过 Hugging Face Hub 自动下载权重 '{cfg['local_filename']}'。原因: {str(sdk_err)}。 "
                         f"如果是国内部署，建议在终端中先设置环境变量：'export HF_ENDPOINT=https://hf-mirror.com' 再拉起服务；"
                         f"如果是隔离内网，请手动将手动下载的文件放置在本地 '{MODEL_DIR}' 目录下。"),
                        status_code=500)
            else:
                logger.info(f"权重自检通过: {cfg['local_filename']}")


class OCREnginerSrv:

    @staticmethod
    def sort_ocr_results(ocr_results: list) -> list:
        """
        多尺度卡证文本块的物理空间逻辑重排

        修复：使用绝对Y坐标分组，而非相对差值
        - 旧算法：逐个比较与当前行最后元素的Y差 → 导致"链式累积"错误
        - 新算法：与当前行第一个元素比较Y差 → 真正的同行判断
        """
        if not ocr_results:
            return []

        items = []
        for item in ocr_results:
            box, text, score = item[0], item[1], item[2] if len(item) > 2 else 0.9
            x, y = box[0][0], box[0][1]
            items.append({
                "x": x,
                "y": y,
                "text": text.strip(),
                "score": score
            })

        # 按Y坐标排序
        items.sort(key=lambda k: k["y"])

        # 按行分组：与行首元素比较Y差（而非与上一个元素比较）
        lines = []
        if items:
            current_line = [items[0]]
            line_y = items[0]["y"]  # 记录当前行的基准Y坐标

            for item in items[1:]:
                # 关键修复：与行首Y坐标比较，而非与上一个元素比较
                if abs(item["y"] - line_y) < 15:
                    current_line.append(item)
                else:
                    # 当前行结束，按X坐标排序
                    current_line.sort(key=lambda k: k["x"])
                    lines.extend(current_line)
                    # 开始新行
                    current_line = [item]
                    line_y = item["y"]

            # 处理最后一行
            current_line.sort(key=lambda k: k["x"])
            lines.extend(current_line)

        return lines

    @classmethod
    def classify_id_card_side(cls, ocr_results: list) -> str:
        """Rapid classification of Front/Back of ID Cards Based on Word Frequency Topological Features

        优先级：正面 > 背面 > 未知
        当同时包含正反面关键词时（如合影），优先识别为正面（因为正面信息更关键）
        """
        full_text = "\n".join([line[1].strip() for line in ocr_results])

        # 正面关键词（优先判断）
        front_keywords = ["公民身份号码", "姓名", "性别", "住址", "出生", "民族"]
        front_count = sum(1 for k in front_keywords if k in full_text)

        # 背面关键词
        back_keywords = ["签发机关", "有效期限", "有效期", "中华人民共和国居民身份证"]
        back_count = sum(1 for k in back_keywords if k in full_text)

        # 判断逻辑：关键词数量多的优先
        if front_count > 0 and front_count >= back_count:
            return "front"
        if back_count > 0:
            return "back"

        return "unknown"

    @classmethod
    def parse_id_card_front(cls, ocr_results: list) -> dict:
        """人像面提取引擎"""
        sorted_items = cls.sort_ocr_results(ocr_results)
        texts = [item["text"] for item in sorted_items]
        full_text = "\n".join(texts)

        info = {"姓名": "", "性别": "", "民族": "", "出生": "", "住址": "", "公民身份号码": ""}

        # 提取身份证号：增强匹配，处理OCR误识别和粘连
        # 1. 标准18位身份证号格式（允许前后有其他字符）
        id_pattern = r'[1-9]\d{5}(18|19|20)\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}[0-9Xx]'
        id_match = re.search(id_pattern, full_text)
        if id_match:
            info["公民身份号码"] = id_match.group(0)
        else:
            # 2. 回退方案：逐行查找连续18位数字（允许末尾是X）
            for text in texts:
                # 匹配18位数字或17位数字+X
                id_match = re.search(r'[1-9]\d{16}[\dXx]', text)
                if id_match:
                    info["公民身份号码"] = id_match.group(0).upper()
                    break

        birth_match = re.search(r'(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)',
                                full_text)
        if birth_match:
            info["出生"] = birth_match.group(1).replace(" ", "")

        for i, item in enumerate(sorted_items):
            text = item["text"]
            if "姓名" in text:
                val = text.replace("姓名", "").replace(":",
                                                     "").replace("：",
                                                                 "").strip()
                if len(val) >= 2:
                    info["姓名"] = val
                elif i + 1 < len(sorted_items):
                    info["姓名"] = sorted_items[i + 1]["text"]
            elif "性别" in text or "盟" in text:  # OCR 常把"性别"误识别为"盟"
                # 先尝试精确匹配 "性别男" 或 "性别女"，允许空格、冒号、制表符等分隔
                gender_match = re.search(r'[性盟]别?[\s:：]*([男女])', text)
                if gender_match:
                    info["性别"] = gender_match.group(1)
                else:
                    # fallback：去掉"性别"/"盟"后如果整个是"男"或"女"
                    gender_val = text.replace("性别", "").replace(
                        "盟", "").replace(":", "").replace("：", "").strip()
                    if gender_val in ["男", "女"]:
                        info["性别"] = gender_val
            # 处理没有字段名，直接出现"男"或"女"的情况
            elif not info["性别"] and text.strip() in ["男", "女"]:
                info["性别"] = text.strip()
            # 处理"男民族汉"这种粘连
            elif not info["性别"] and re.match(r'^[男女]', text):
                gender_match = re.match(r'^([男女])', text)
                if gender_match:
                    info["性别"] = gender_match.group(1)
                # 同时尝试提取民族（如"男民族汉" -> "汉"）
                if not info["民族"]:
                    nation_match = re.search(r'[男女]民[族旗]?([^\s性别出生住址公民]{1,5})', text)
                    if nation_match:
                        info["民族"] = nation_match.group(1)
            # 处理"民汉"这种直接粘连（没有"族"字）
            elif not info["民族"] and re.match(r'^民[^族]', text):
                # "民汉" -> "汉"
                nation_match = re.match(r'^民([^族\s]{1,5})', text)
                if nation_match:
                    info["民族"] = nation_match.group(1)
            elif "民族" in text or "民旗" in text:  # OCR常把"民族"误识别为"民旗"
                # 先尝试精确匹配 "民族XX" 或 "民旗XX"，不包含其他字段关键词
                nation_match = re.search(r'民[族旗]\s*([^\s性别出生住址公民]{1,5})', text)
                if nation_match:
                    info["民族"] = nation_match.group(1)
                else:
                    # fallback
                    nation_val = text.replace("民族",
                                              "").replace(":", "").replace(
                                                  "：", "").strip()
                    # 去除常见误识别（如果包含其他字段关键词就跳过）
                    if len(nation_val) >= 1 and not any(
                            k in nation_val
                            for k in ["性别", "出生", "住址", "男", "女"]):
                        info["民族"] = nation_val
            elif "住址" in text or "址" in text:
                addr_parts = [text.replace("住址", "").replace("址", "").strip()]
                j = i + 1
                while j < len(sorted_items):
                    next_text = sorted_items[j]["text"]
                    # 停止条件：遇到身份证号、或其他字段关键词
                    if any(k in next_text for k in ["公民身份号码", "号码", "身份"]):
                        break
                    # 如果这行包含18位数字（身份证号pattern），也停止
                    if re.search(r'[1-9]\d{17}', next_text):
                        break
                    if len(next_text) > 2 and not any(
                            k in next_text for k in ["姓名", "性别", "民族", "出生"]):
                        addr_parts.append(next_text)
                    j += 1
                info["住址"] = "".join(addr_parts)

        # regex fallback: 当性别/民族与其他字段在同一 OCR token 中时（如"性别男民族汉"），per-item 逻辑会漏掉
        if not info["性别"]:
            # 匹配"性别"或常见误识别"盟"
            gm = re.search(r'[性盟]别?[\s:：]*([男女])', full_text)
            if gm:
                info["性别"] = gm.group(1)
            # 如果还找不到，找独立的"男"或"女"（前后没有其他汉字）
            if not info["性别"]:
                gm2 = re.search(r'(?:^|\n)([男女])(?:民族|$|\n)', full_text)
                if gm2:
                    info["性别"] = gm2.group(1)
        if not info["民族"]:
            # 支持"民族"和"民旗"（OCR误识别）
            nm = re.search(r'民[族旗]\s*([^\s性别出生住址公民]{1,5})', full_text)
            if nm:
                info["民族"] = nm.group(1)
            # 如果还找不到，尝试"民X"模式（直接粘连，如"民汉"）
            if not info["民族"]:
                nm2 = re.search(r'(?:^|\n|[男女])民([^族旗\s]{1,3})(?:\n|$)', full_text)
                if nm2:
                    info["民族"] = nm2.group(1)

        return info

    @classmethod
    def parse_id_card_back(cls, ocr_results: list) -> dict:
        """国徽面提取引擎"""
        texts = [line[1].strip() for line in ocr_results]
        full_text = "\n".join(texts)

        info = {"签发机关": "", "有效期限": ""}

        # 提取签发机关：需要排除无效内容
        # 常见无效内容："居民身份证"、"中华人民共和国"
        invalid_issuer_keywords = ["居民身份证", "中华人民共和国", "身份证", "有效期限"]

        # 方法1：正则提取签发机关（更灵活，支持OCR误识别）
        # 匹配 "签发机关" 后面的内容（可能有冒号、空格等分隔符）
        issuer_pattern = r'签发机关[\s:：]*([^\n\d]{2,20})'
        issuer_match = re.search(issuer_pattern, full_text)
        if issuer_match:
            candidate = issuer_match.group(1).strip()
            # 检查是否为无效内容
            if not any(invalid in candidate for invalid in invalid_issuer_keywords):
                info["签发机关"] = candidate

        # 方法2：如果方法1失败，逐行匹配并寻找有效的签发机关
        if not info["签发机关"]:
            found_keyword = False
            for i, t in enumerate(texts):
                # 找到"签发机关"关键词所在行
                if any(kw in t for kw in ["签发机关", "签发", "机关"]):
                    found_keyword = True
                    # 尝试从当前行提取
                    val = t
                    for remove_word in ["签发机关", "签发", "机关", ":", "：", "发证", "发"]:
                        val = val.replace(remove_word, "")
                    val = val.strip()

                    # 如果当前行提取到有效内容（2个字以上，不全是数字，不是无效关键词）
                    if len(val) >= 2 and not val.isdigit() and not any(invalid in val for invalid in invalid_issuer_keywords):
                        info["签发机关"] = val
                        break
                    # 否则继续往后找，直到找到有效内容
                    elif i + 1 < len(texts):
                        # 从下一行开始往后找，跳过无效内容
                        for j in range(i + 1, len(texts)):
                            next_line = texts[j].strip()
                            # 跳过有效期行（包含日期格式）
                            if re.search(r'\d{4}.*\d{4}|长期', next_line):
                                continue
                            # 跳过无效关键词
                            if any(invalid in next_line for invalid in invalid_issuer_keywords):
                                continue
                            # 跳过纯数字或过短的内容
                            if next_line.isdigit() or len(next_line) < 2:
                                continue
                            # 找到有效签发机关
                            info["签发机关"] = next_line
                            break
                        if info["签发机关"]:
                            break

        # 如果还是没找到，尝试在所有文本中找包含"公安局"、"派出所"等关键词的行
        if not info["签发机关"]:
            for t in texts:
                if any(kw in t for kw in ["公安局", "派出所", "公安分局", "公安厅"]):
                    if not any(invalid in t for invalid in invalid_issuer_keywords):
                        info["签发机关"] = t.strip()
                        break

        # 提取有效期限
        period_match = re.search(
            r'(\d{4}[\.\-\:\/]\d{2}[\.\-\:\/]\d{2}\s*-\s*(\d{4}[\.\-\:\/]\d{2}[\.\-\:\/]\d{2}|长期))',
            full_text)
        if period_match:
            info["有效期限"] = period_match.group(1).replace(" ", "")

        return info

    @classmethod
    def parse_passport(cls, ocr_results: list) -> dict:
        """护照高容错机读码(MRZ)解码引擎"""
        mrz_lines = []
        for line in ocr_results:
            text = line[1].replace(" ", "").upper()
            if len(text) >= 40 and text.count('<') >= 5:
                mrz_lines.append(text)

        if len(mrz_lines) >= 2:
            target_mrz = mrz_lines[-2:]
            mrz_string = f"{target_mrz[0]}\n{target_mrz[1]}"
            try:
                checker = TD3CodeChecker(mrz_string)
                if checker:
                    fields = checker.fields()
                    return {
                        "解析成功": "是",
                        "护照号": fields.document_number,
                        "姓": fields.surname,
                        "名": fields.given_names,
                        "国籍": fields.nationality,
                        "出生日期": fields.birth_date,
                        "性别": fields.sex,
                        "有效期至": fields.expiry_date
                    }
            except Exception as e:
                logger.warning(f"MRZ 校验失效: {str(e)}")
                return {
                    "解析成功": "否",
                    "错误原因": f"MRZ 校验异常: {str(e)}",
                    "提取原始区": mrz_string
                }

        return {"解析成功": "否", "错误原因": "未检出合规双行护照 MRZ 区"}

    @classmethod
    def parse_bank_card(cls, ocr_results: list) -> dict:
        """银行卡字段提取引擎

        提取字段：
        - 卡号：16-19位数字（支持空格分隔）
        - 银行名称：关键词匹配

        利用坐标信息：银行卡号通常在卡片中下部凸起区域，Y坐标较大
        """
        if not ocr_results:
            return {"卡号": "", "银行名称": ""}

        texts = [line[1].strip() for line in ocr_results]
        full_text = "\n".join(texts)

        info = {"卡号": "", "银行名称": ""}

        # 提取卡号：利用坐标信息（卡号通常在Y坐标较大的位置，且是凸起数字）
        # 1. 收集所有数字片段及其坐标
        digit_items = []
        for item in ocr_results:
            box, text, score = item[0], item[1], item[2] if len(item) > 2 else 0.9
            y_center = (box[0][1] + box[2][1]) / 2  # 取矩形框中心Y坐标
            x_left = box[0][0]  # 左边界X坐标

            # 提取所有连续数字（长度>=3）
            digits = re.findall(r'\d{3,}', text)
            for digit in digits:
                digit_items.append({
                    "y": y_center,
                    "x": x_left,
                    "text": digit,
                    "score": score,
                    "length": len(digit)
                })

        # 2. 按Y坐标分组，找到最可能是卡号的那一行
        if digit_items:
            # 按 Y 坐标聚类（容忍更大的偏差，因为卡号数字可能有轻微倾斜或高低差）
            y_coords = [item["y"] for item in digit_items]
            y_threshold = 30  # 放宽到 30px，适应更多场景

            # 将数字片段按 Y 坐标分组
            y_groups = []
            for item in digit_items:
                added = False
                for group in y_groups:
                    # 如果与组内任意元素的 Y 坐标差小于阈值，加入该组
                    if any(abs(item["y"] - g["y"]) < y_threshold for g in group):
                        group.append(item)
                        added = True
                        break
                if not added:
                    y_groups.append([item])

            # 3. 选择最可能是卡号的那一组（优先：总长度最长的组）
            best_group = None
            max_total_length = 0

            for group in y_groups:
                total_length = sum(item["length"] for item in group)
                if total_length > max_total_length:
                    max_total_length = total_length
                    best_group = group

            # 4. 合并选中组内的所有数字片段
            if best_group:
                # 按 X 坐标从左到右排序
                best_group.sort(key=lambda k: k["x"])
                combined = ''.join([item["text"] for item in best_group])

                # 验证合并后的长度是否合理（银行卡号通常 16-19 位）
                if len(combined) >= 12:
                    info["卡号"] = combined[:19]  # 最多保留 19 位
                elif len(combined) >= 4:
                    # 即使不足标准长度，也保留（可能是特殊卡）
                    info["卡号"] = combined

        # 回退方案：标准格式匹配
        if not info["卡号"]:
            card_number_pattern = r'(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}(?:[\s\-]?\d{3})?)'
            card_match = re.search(card_number_pattern, full_text)
            if card_match:
                info["卡号"] = card_match.group(1).replace(" ", "").replace("-", "")

        # 提取银行名称：关键词匹配
        bank_keywords = {
            "工商银行": ["工商", "ICBC"],
            "农业银行": ["农业", "ABC"],
            "建设银行": ["建设", "CCB"],
            "中国银行": ["中国银行", "BOC", "BANK OF CHINA"],
            "交通银行": ["交通", "BCM"],
            "招商银行": ["招商", "CMB"],
            "邮政储蓄": ["邮政", "PSBC"],
            "民生银行": ["民生", "CMBC"],
            "中信银行": ["中信", "CITIC"],
            "光大银行": ["光大", "CEB"],
            "浦发银行": ["浦发", "SPDB"],
            "兴业银行": ["兴业", "CIB"],
            "平安银行": ["平安银行", "PAB"],
            "华夏银行": ["华夏", "HXB"],
            "广发银行": ["广发", "GDB"]
        }

        for bank_name, keywords in bank_keywords.items():
            if any(kw in full_text for kw in keywords):
                info["银行名称"] = bank_name
                break

        # 银行名称回退方案：提取包含"银行"/"信用社"的文本行
        if not info["银行名称"]:
            for text in texts:
                # 匹配包含"银行"、"信用社"、"信用联社"、"农商行"等的文本
                if re.search(r'(银行|信用社|信用联社|农商行|农信社)', text):
                    # 清理掉常见的非银行名称部分
                    cleaned = re.sub(r'(卡号|账号|户名|开户行[:：]?|发卡行[:：]?)', '', text).strip()
                    if len(cleaned) >= 4:  # 至少4个字符才认为是有效银行名
                        info["银行名称"] = cleaned
                        break

        return info
