#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""图像预处理：识别前对裁剪出的卡证图像做增强"""

import cv2
import numpy as np


def preprocess_bank_card_image(img_np: np.ndarray) -> np.ndarray:
    """银行卡图像预处理：增强凸起数字的识别效果

    针对银行卡凸起数字的特点：
    1. 灰度化
    2. CLAHE 自适应直方图均衡化（增强对比度）
    3. 去噪
    4. 二值化（可选）

    Args:
        img_np: 原始RGB图像数组

    Returns:
        预处理后的图像数组（RGB格式，保持与OCR引擎兼容）
    """
    # 1. 转为灰度图
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)

    # 2. CLAHE 自适应直方图均衡化（增强局部对比度，对凸起数字特别有效）
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # 3. 高斯去噪（减少图像噪声）
    denoised = cv2.GaussianBlur(enhanced, (3, 3), 0)

    # 4. 可选：锐化（增强边缘，凸起数字边缘更清晰）
    kernel = np.array([[-1, -1, -1],
                       [-1,  9, -1],
                       [-1, -1, -1]])
    sharpened = cv2.filter2D(denoised, -1, kernel)

    # 5. 转回RGB（保持与OCR引擎的接口一致）
    result = cv2.cvtColor(sharpened, cv2.COLOR_GRAY2RGB)

    return result
