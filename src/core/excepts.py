#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from typing import Any, Optional

class ErrorCode:
    """Business system error code"""
    SUCCESS = 0
    SYSTEM_ERROR = 50000
    DATABASE_ERROR = 50100
    FILE_ERROR = 50200
    OCR_ENGINE_ERROR = 50300
    QUEUE_ERROR = 50400
    BUSINESS_ERROR = 50500

class AppException(Exception):
    """Global control of business interception exception classes"""
    def __init__(self, code: int, message: str, status_code: int=400, data: Optional[Any] =None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.data = data
