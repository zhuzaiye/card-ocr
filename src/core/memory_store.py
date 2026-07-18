#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
内存存储：替代 SQLite，用于 OCR 批次状态和结果的临时存储
所有数据只在内存中，服务重启后丢失，确保不在服务端持久化用户数据
"""

import time
from queue import Queue
from threading import Lock
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class DetectedCard:
    """一张图片中检测出的单张卡证识别结果"""
    card_type: str  # 'idcard_front' | 'idcard_back' | 'bankcard' | 'passport' | 'unknown' | ...
    data: Dict = field(default_factory=dict)
    raw_text: Optional[List[str]] = None  # 仅 card_type == 'unknown' 时填充，供人工核对
    cropped_image_b64: Optional[str] = None  # 该卡证在原图中的裁剪区域（base64 编码的 JPEG），用于前端展示


@dataclass
class SubTaskResult:
    """单个子任务（一张上传图片）的识别结果，一张图可能检测出 0~N 张卡"""
    subtask_id: str
    row_index: int
    slot_index: int  # 在该行中的上传顺序号，用于前端匹配图片
    filename: str
    status: str  # 'pending' | 'processing' | 'completed' | 'failed'
    cards: List["DetectedCard"] = field(default_factory=list)


@dataclass
class BatchState:
    """批次状态（内存中）"""
    batch_id: str
    doc_type: str
    total_count: int
    processed_count: int = 0
    status: str = "processing"  # 'processing' | 'completed' | 'failed'
    created_at: float = field(default_factory=time.time)
    results: List[SubTaskResult] = field(default_factory=list)


@dataclass
class OCRTask:
    """OCR 任务（放入队列）"""
    subtask_id: str
    batch_id: str
    row_index: int
    slot_index: int  # 在该行中的上传顺序号
    filename: str
    image_b64: str


class MemoryStore:
    """全局内存存储单例"""

    def __init__(self):
        self.batch_cache: Dict[str, BatchState] = {}
        self.lock = Lock()
        self.ocr_queue = Queue()

    def create_batch(self, batch_id: str, doc_type: str, total_count: int) -> BatchState:
        """创建新批次"""
        with self.lock:
            batch = BatchState(
                batch_id=batch_id,
                doc_type=doc_type,
                total_count=total_count
            )
            self.batch_cache[batch_id] = batch
            return batch

    def get_batch(self, batch_id: str) -> Optional[BatchState]:
        """获取批次状态"""
        with self.lock:
            return self.batch_cache.get(batch_id)

    def add_result(self, batch_id: str, result: SubTaskResult):
        """添加子任务结果"""
        with self.lock:
            batch = self.batch_cache.get(batch_id)
            if not batch:
                return

            batch.results.append(result)
            batch.processed_count += 1

            if batch.processed_count >= batch.total_count:
                batch.status = "completed"

    def update_subtask_status(self, batch_id: str, subtask_id: str, status: str):
        """更新子任务状态"""
        with self.lock:
            batch = self.batch_cache.get(batch_id)
            if not batch:
                return

            for result in batch.results:
                if result.subtask_id == subtask_id:
                    result.status = status
                    break

    def delete_batch(self, batch_id: str):
        """删除批次（清理内存）"""
        with self.lock:
            self.batch_cache.pop(batch_id, None)

    def cleanup_expired(self, ttl_seconds: int = 1800):
        """清理过期批次（TTL: 30 分钟）"""
        cutoff = time.time() - ttl_seconds
        with self.lock:
            expired = [bid for bid, batch in self.batch_cache.items()
                      if batch.created_at < cutoff]
            for bid in expired:
                del self.batch_cache[bid]
        return len(expired)


# 全局单例
memory_store = MemoryStore()
