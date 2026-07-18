#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from typing import List
from fastapi import UploadFile, File
from src.core.config import MAX_FILE_SIZE, ALLOWED_MIME_TYPES
from src.core.excepts import AppException, ErrorCode


async def validate_ocr_file(files: List[UploadFile] = File(...)) -> List[UploadFile]:
    """Streaming non-blocking boundary interceptor for multiple files"""
    for file in files:
        if file.content_type not in ALLOWED_MIME_TYPES:
            raise AppException(
                code=ErrorCode.FILE_ERROR,
                message=
                f"unsupport MIME type: {file.content_type}. Only accept JPEG, PNG, BMP"
            )

        body = await file.read(MAX_FILE_SIZE + 1)
        if len(body) > MAX_FILE_SIZE:
            raise AppException(
                code=ErrorCode.FILE_ERROR,
                message="the single img exceeds the maximum limit (10MB)")

        await file.seek(0)

    return files
