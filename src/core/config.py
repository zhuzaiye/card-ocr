#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
from pathlib import Path

# Define basic directions
BASE_DIR = Path(__file__).resolve().parent.parent.parent


MODEL_DIR = BASE_DIR / "model"
RUNTIME_DIR = BASE_DIR / "runtime"
LOG_PATH = RUNTIME_DIR / "app.log"

# Automatic detection and physical completion during system initialization
for directory in [MODEL_DIR, RUNTIME_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# Limitation arguments
MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/bmp"}

# 对应 Hugging Face 官方 PaddlePaddle pp-ocrv6 集合下的具体 Repo 名称
MODELS_CONFIG = {
    "det": {
        "repo_id": "PaddlePaddle/PP-OCRv6_medium_det_onnx",
        "filename": "inference.onnx",
        "local_filename": "PP-OCRv6_medium_det_infer.onnx"  # 规整化落盘名称
    },
    "rec": {
        "repo_id": "PaddlePaddle/PP-OCRv6_medium_rec_onnx",
        "filename": "inference.onnx",
        "local_filename": "PP-OCRv6_medium_rec_infer.onnx"
    }
}

# RapidOCR 字符字典路径（PP-OCRv6 专用词表，18708字符）
REC_CHAR_DICT_PATH = MODEL_DIR / "ppocrv6_dict.txt"
