#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
from loguru import logger
from src.core.config import LOG_PATH

# Clear default terminal console
logger.remove()


# 1.Bind highly readable console output
logger.add(
    sys.stdout,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level:7}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO",
)

# 2.Bind high-performance physical log archiving control with automatic rotation and compression
logger.add(
    str(LOG_PATH),
    rotation="5 MB",
    retention="5 days",
    compression="zip",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level:7} | {name}:{function}:{line} - {message}",
    level="INFO",
    encoding="utf-8",
)