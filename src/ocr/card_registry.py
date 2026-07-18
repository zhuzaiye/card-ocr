#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
卡证类型注册表：关键词判定与 parse 函数的唯一权威配置源
新增证件类型时只需在 CARD_TYPE_REGISTRY 追加一条 CardTypeSignature
"""

from dataclasses import dataclass
from typing import Callable, List, Optional

from src.ocr.ocr_engine import OCREnginerSrv
from src.ocr.image_preprocess import preprocess_bank_card_image


@dataclass
class CardTypeSignature:
    card_type: str
    keywords: List[str]
    parse_func: Callable[[list], dict]
    preprocess_func: Optional[Callable] = None
    priority: int = 0


CARD_TYPE_REGISTRY: List[CardTypeSignature] = [
    CardTypeSignature(
        card_type="idcard_front",
        keywords=["公民身份号码", "姓名", "性别", "民族"],
        parse_func=OCREnginerSrv.parse_id_card_front,
        priority=10,
    ),
    CardTypeSignature(
        card_type="idcard_back",
        keywords=["签发机关", "有效期限", "中华人民共和国"],
        parse_func=OCREnginerSrv.parse_id_card_back,
        priority=10,
    ),
    CardTypeSignature(
        card_type="passport",
        keywords=["护照", "PASSPORT"],
        parse_func=OCREnginerSrv.parse_passport,
        priority=8,
    ),
    CardTypeSignature(
        card_type="bankcard",
        keywords=["卡号", "银行", "信用社", "UnionPay", "VISA", "MasterCard", "借记卡", "储蓄卡"],
        parse_func=OCREnginerSrv.parse_bank_card,
        preprocess_func=preprocess_bank_card_image,
        priority=5,
    ),
]


def classify_card_by_texts(texts: List[str]) -> str:
    """按 priority 降序遍历注册表，命中任一关键词即返回该 card_type；全不命中返回 'unknown'"""
    full_text = "".join(texts)
    for signature in sorted(CARD_TYPE_REGISTRY, key=lambda s: s.priority, reverse=True):
        if any(kw in full_text for kw in signature.keywords):
            return signature.card_type
    return "unknown"


def detect_mixed_types_in_texts(texts: List[str]) -> List[str]:
    """检测一批文本中出现了哪几种已知卡证类型（用于判断一个聚类簇是否混杂了多张卡）

    Returns:
        命中的所有 card_type 列表（按 priority 降序），不含 'unknown'
    """
    full_text = "".join(texts)
    matched = []
    for signature in sorted(CARD_TYPE_REGISTRY, key=lambda s: s.priority, reverse=True):
        if any(kw in full_text for kw in signature.keywords):
            matched.append(signature.card_type)
    return matched


def get_signature(card_type: str) -> Optional[CardTypeSignature]:
    for signature in CARD_TYPE_REGISTRY:
        if signature.card_type == card_type:
            return signature
    return None
