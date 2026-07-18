# 卡证 OCR 识别系统

本地化、隐私优先的卡证 OCR 识别系统，支持身份证、银行卡、护照等多种卡证类型的自动识别与批量校对。

<video src="./assets//test_demo_video.webm" width="60%" controls autoplay loop muted></video>


## 核心特性

- ✅ **免模版智能分类**: 无需预选模版，后端根据关键词自动判定卡证类型（身份证正/反面、银行卡、护照）
- ✅ **合影多卡检测**: 一张图里混杂多张卡证时，基于文本框空间聚类（DBSCAN）自动分割区域并逐一识别
- ✅ **数据隐私优先**: 服务端不持久化任何用户数据，图片和识别结果仅在内存中临时存在
- ✅ **实时进度反馈**: 基于 SSE（Server-Sent Events）的实时推送，0 延迟进度更新
- ✅ **逐行批量上传**: 按行提交，每行不限数量图片，支持几十到上百张图片的并发识别
- ✅ **图片并排校对**: 原图与识别结果并排显示，支持图片放大查看和字段编辑
- ✅ **本地历史记录**: 识别结果保存在浏览器本地，支持查看历史批次详情与容量管理
- ✅ **本地部署**: 基于 PP-OCRv6 ONNX 模型，完全离线运行，无外部依赖

## 技术栈

### 后端
- **框架**: FastAPI
- **OCR 引擎**: RapidOCR (PP-OCRv6 ONNX)
- **多卡聚类**: scikit-learn (DBSCAN)
- **护照解析**: mrz（MRZ 码解析）
- **队列**: Python 原生 Queue + 线程池
- **存储**: 纯内存（无数据库）
- **依赖管理**: uv

### 前端
- **框架**: React 19 + TypeScript
- **UI 库**: DaisyUI (Tailwind CSS 4)
- **构建工具**: Vite
- **实时通信**: EventSource (SSE)
- **Excel 生成**: xlsx（浏览器端直接生成，无需后端）
- **历史存储**: localStorage

## 快速开始

### 环境要求

- Python 3.11（见 `.python-version`）
- Node.js 18+
- [uv](https://docs.astral.sh/uv/)（Python 依赖管理）

### 安装依赖

**后端**:
```bash
cd /data/projects/awsome-llm/card-ocr
uv sync
```

**前端**:
```bash
cd web
pnpm install
pnpm dev
```

### 启动服务

```bash
# 启动后端（自动启动 OCR worker 线程池，首次启动会自动从 Hugging Face 下载模型）
uv run python src/main.py
cd web && pnpm dev

# 访问
open http://localhost:5173
```

## 使用流程

1. **逐行上传**: 每行可上传任意数量图片（如身份证正反面、多张合照），无需预先选择模版
2. **提交识别**: 点击提交，实时查看该行识别进度
3. **自动分类识别**: 后端自动判定卡证类型；如图中混杂多张卡证（如合影），自动分割区域分别识别
4. **校对结果**: 原图与识别结果并排显示，可编辑字段
5. **下载 Excel**: 校对完成后在浏览器端直接生成并下载 Excel
6. **查看历史**: 随时切换到历史记录，查看/删除此前保存在本地的批次

## 配置说明

### 依赖模型

首次启动时会自动从 Hugging Face 下载 PP-OCRv6 模型：
- 检测模型: `PaddlePaddle/PP-OCRv6_medium_det_onnx`
- 识别模型: `PaddlePaddle/PP-OCRv6_medium_rec_onnx`

### Worker 数量

修改 `src/main.py` 中的 `start_workers(num_workers=2)`，根据 CPU 核数调整。


## 许可证

MIT License
