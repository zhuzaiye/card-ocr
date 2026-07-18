#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
import base64
import asyncio
import orjson
from typing import List
from fastapi import APIRouter, Form, UploadFile, File, Depends
from fastapi.responses import StreamingResponse
from src.core.excepts import AppException, ErrorCode
from src.api.middleware import validate_ocr_file
from src.api.schemas import UnifiedResponse, SubmitRowResult
from src.core.memory_store import memory_store, OCRTask
from src.core.logger import logger

router = APIRouter(prefix="/api/ocr", tags=["OCR卡证识别引擎"])


@router.post("/submit-row", response_model=UnifiedResponse[SubmitRowResult])
async def submit_row(
    files: List[UploadFile] = Depends(validate_ocr_file),
    batch_id: str = Form(...),
    row_index: int = Form(...),
    slot_indices: List[int] = Form(...),  # 每个文件的上传顺序号，仅用于前端匹配图片
):
    """提交一行任务（不限数量图片，卡证类型由后端自动检测）"""
    if len(files) != len(slot_indices):
        raise AppException(code=ErrorCode.FILE_ERROR, message="slot_indices 数量与 files 不匹配")

    # 幂等创建 batch
    batch = memory_store.get_batch(batch_id)
    if not batch:
        batch = memory_store.create_batch(batch_id, doc_type="mixed", total_count=0)

    # 更新 total_count
    batch.total_count += len(files)

    subtask_ids = []
    for file, slot_index in zip(files, slot_indices):
        subtask_id = str(uuid.uuid4())
        file_bytes = await file.read()
        img_b64 = base64.b64encode(file_bytes).decode('utf-8')

        # 创建任务放入队列
        task = OCRTask(
            subtask_id=subtask_id,
            batch_id=batch_id,
            row_index=row_index,
            slot_index=slot_index,
            filename=file.filename,
            image_b64=img_b64
        )
        memory_store.ocr_queue.put(task)
        subtask_ids.append(subtask_id)

        logger.info(f"任务已入队: {file.filename} (batch={batch_id}, row={row_index}, slot={slot_index})")

    return UnifiedResponse(data=SubmitRowResult(
        batch_id=batch_id,
        row_index=row_index,
        subtask_ids=subtask_ids
    ))


@router.get("/stream/{batch_id}")
async def stream_batch_status(batch_id: str):
    """SSE 流式推送批次状态"""

    async def event_generator():
        """生成 SSE 事件流"""
        last_processed = 0

        while True:
            batch = memory_store.get_batch(batch_id)

            if not batch:
                # batch 不存在，发送错误后关闭
                yield f"data: {orjson.dumps({'error': 'batch not found'}).decode()}\n\n"
                break

            # 只推送新完成的结果（增量推送）
            if batch.processed_count > last_processed:
                # 构造响应数据
                items = []
                for result in batch.results:
                    items.append({
                        "subtask_id": result.subtask_id,
                        "filename": result.filename,
                        "status": result.status,
                        "row_index": result.row_index,
                        "slot_index": result.slot_index,
                        "cards": [
                            {
                                "card_type": card.card_type,
                                "data": card.data,
                                "raw_text": card.raw_text,
                                "cropped_image_b64": card.cropped_image_b64,
                            }
                            for card in result.cards
                        ]
                    })

                payload = {
                    "batch_id": batch.batch_id,
                    "status": batch.status,
                    "total_count": batch.total_count,
                    "processed_count": batch.processed_count,
                    "progress_percent": round((batch.processed_count / batch.total_count) * 100, 2) if batch.total_count > 0 else 0,
                    "items": items
                }

                yield f"data: {orjson.dumps(payload).decode()}\n\n"
                last_processed = batch.processed_count

            # 如果批次完成，关闭连接
            if batch.status == "completed":
                logger.info(f"SSE 流关闭: batch={batch_id} (completed)")
                break

            # 等待 500ms 后再检查
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@router.patch("/subtask/{subtask_id}/card/{card_index}", response_model=UnifiedResponse[dict])
async def update_subtask_card(subtask_id: str, card_index: int, data: dict):
    """更新子任务中某一张卡证的字段（用户校对后）；一个 subtask 可能检测出多张卡，需按 card_index 定位"""
    # 遍历所有 batch 找到对应的 subtask
    updated = False
    for batch in memory_store.batch_cache.values():
        for result in batch.results:
            if result.subtask_id == subtask_id:
                if card_index < 0 or card_index >= len(result.cards):
                    raise AppException(code=ErrorCode.DATABASE_ERROR, message="无效的 card_index")
                # 更新非 _ 开头的字段
                for k, v in data.items():
                    if not k.startswith("_"):
                        result.cards[card_index].data[k] = v
                updated = True
                break
        if updated:
            break

    if not updated:
        raise AppException(code=ErrorCode.DATABASE_ERROR, message="无效的子任务标识")

    return UnifiedResponse(data={"subtask_id": subtask_id, "card_index": card_index, "updated": True})
