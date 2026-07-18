#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import numpy as np
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from src.core.logger import logger
from src.core.excepts import AppException
from src.ocr.ocr_engine import ModelManagerSrv
from src.api.router import router as ocr_router
from src.tasks.ocr_worker import start_workers, get_ocr_worker_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("系统冷启动：执行持久化与本地权重环境自检...")

    try:
        ModelManagerSrv.check_and_download_models()
        logger.info("系统自检结束：卡证 OCR 环境正常。")

        # 预热 ONNX 推理引擎：提前触发单例加载 + 一次空跑推理，
        # 避免冷启动延迟（session 创建、内存分配器初始化）转嫁到第一个用户请求上
        logger.info("正在预热 OCR 推理引擎...")
        engine = get_ocr_worker_engine()
        engine(np.zeros((100, 100, 3), dtype=np.uint8))
        logger.info("OCR 推理引擎预热完成，服务已就绪。")
    except Exception as e:
        logger.error(f"冷启动安全自检异常: {str(e)}")

    # 启动 OCR worker 线程池（2 个线程），复用同一个预热好的引擎单例
    start_workers(num_workers=2)
    logger.info("OCR worker 线程池已启动(2 workers)。")

    yield

    logger.info("系统正常关闭：正在清退运行时状态。")


app = FastAPI(
    title="Local Card OCR System Engine (SSE Architecture)",
    description="本地化高性能卡证 OCR 识别系统，基于 SSE 实时推送 + 内存队列，无持久化用户数据。",
    version="4.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局业务异常捕获
@app.exception_handler(AppException)
async def unified_app_exception_handler(request: Request, exc: AppException):
    logger.warning(f"业务异常触发拦截 - Code: {exc.code} - Message: {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": exc.code,
            "message": exc.message,
            "data": exc.data
        }
    )

# 全局致命未知错误捕获
@app.exception_handler(Exception)
async def unified_system_exception_handler(request: Request, exc: Exception):
    logger.error(f"全局系统致命异常捕获: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "code": 50000,
            "message": f"服务器内部组件遭遇致命崩溃: {str(exc)}",
            "data": None
        }
    )

app.include_router(ocr_router)

if __name__ == "__main__":
    uvicorn.run("src.main:app", host="127.0.0.1", port=8000, reload=False)
