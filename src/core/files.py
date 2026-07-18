#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from pathlib import Path
from typing import List
import aiofiles
from src.core.config import UPLOAD_DIR, DOWNLOAD_DIR
from src.core.logger import logger
from src.core.excepts import AppException, ErrorCode


class FileManagerService:

    @staticmethod
    async def save_uploaded_file_async(file_bytes: bytes,
                                       filename: str) -> Path:
        """使用 aiofiles 异步写盘，完美释放 I/O 阻塞"""
        safe_name = Path(filename).name
        target_path = UPLOAD_DIR / safe_name
        try:
            async with aiofiles.open(target_path, "wb") as f:
                await f.write(file_bytes)
            return target_path
        except Exception as e:
            logger.error(f"物理层异步写盘失败: {safe_name}, {str(e)}", exc_info=True)
            raise AppException(code=ErrorCode.FILE_ERROR,
                               message="本地物理存储介质异步写入异常")

    @staticmethod
    def delete_batch_resources(local_paths: List[str]):
        """级联安全物理删除"""
        for path_str in local_paths:
            if not path_str:
                continue
            path = Path(path_str)
            try:
                # 限制删除仅在 upload 与 downloads 作用域中发生，防任意文件删除攻击
                allowed = path.resolve().is_relative_to(UPLOAD_DIR) or path.resolve().is_relative_to(DOWNLOAD_DIR)
                if path.exists() and allowed:
                    if path.is_file():
                        path.unlink()
                        logger.info(f"清退本地物理资源: {path.name}")
            except Exception as e:
                logger.warning(f"本地遗留物理资源处理挂起 {path_str}: {str(e)}")
