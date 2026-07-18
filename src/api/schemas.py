#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from pydantic import BaseModel
from typing import Generic, TypeVar, Optional, List

T = TypeVar('T')


class UnifiedResponse(BaseModel, Generic[T]):
    code: int = 0
    message: str = "success"
    data: Optional[T] = None


class SubmitRowResult(BaseModel):
    batch_id: str
    row_index: int
    subtask_ids: List[str]
