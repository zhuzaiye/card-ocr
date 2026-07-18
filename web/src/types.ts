export interface ApiResponse<T> {
  code: number
  message: string
  data: T | null
}

// 每种已知卡证类型对应的识别字段定义（单一数据源，excelGenerator 和 RowResultPanel 共用）
// 新增卡证类型时只需在此追加一条；未登记的 card_type（如 'unknown'）走原始文本展示分支
export interface CardFieldDef {
  label: string
  key: string
  span?: 2
}

export const KNOWN_CARD_FIELDS: Record<string, CardFieldDef[]> = {
  idcard_front: [
    { label: '姓名', key: '姓名' },
    { label: '性别', key: '性别' },
    { label: '民族', key: '民族' },
    { label: '出生', key: '出生' },
    { label: '住址', key: '住址', span: 2 },
    { label: '公民身份号码', key: '公民身份号码', span: 2 },
  ],
  idcard_back: [
    { label: '签发机关', key: '签发机关' },
    { label: '有效期限', key: '有效期限' },
  ],
  bankcard: [
    { label: '卡号', key: '卡号' },
    { label: '银行名称', key: '银行名称' },
  ],
  passport: [
    { label: '护照号', key: '护照号' },
    { label: '姓', key: '姓' },
    { label: '名', key: '名' },
    { label: '国籍', key: '国籍' },
    { label: '出生日期', key: '出生日期' },
    { label: '性别', key: '性别' },
    { label: '有效期至', key: '有效期至' },
  ],
}

// 各 card_type 在 Excel 导出/展示时的排序优先级，需与后端 card_registry.py 的 priority 保持一致语义
// （数值越大越靠前；未登记的类型视为最低优先级，排在最后）
export const CARD_TYPE_ORDER: string[] = ['idcard_front', 'idcard_back', 'passport', 'bankcard']

export function cardTypeSortIndex(cardType: string): number {
  const idx = CARD_TYPE_ORDER.indexOf(cardType)
  return idx === -1 ? CARD_TYPE_ORDER.length : idx
}

// 一张图片中检测出的单张卡证识别结果
export interface DetectedCard {
  card_type: string
  data: Record<string, unknown>
  raw_text?: string[] | null   // 仅 card_type === 'unknown' 时存在，供人工核对
  cropped_image_b64?: string | null   // 该卡证在原图中的裁剪区域（base64 JPEG），用于结果面板展示
}

export interface SubTask {
  subtask_id: string
  filename: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  row_index: number
  slot_index: number   // 上传顺序号，用于匹配图片，不代表卡证类型
  cards: DetectedCard[]   // 一张图可能检测出 0~N 张卡
}

export interface BatchStatus {
  batch_id: string
  status: 'processing' | 'completed' | 'failed'
  total_count: number
  processed_count: number
  progress_percent: number
  items: SubTask[]
}

export interface SubmitResult {
  batch_id: string
  total: number
}

// ── Row-based upload types ──

// 一行内已上传的一张图片（不再有槏位/card_type 声明，卡证类型由后端检测）
export interface UploadedImage {
  slot_index: number        // 上传顺序号，仅用于 img_ localStorage key
  file: File
  uniqueName: string
  preview: string | null
}

export interface RowEntry {
  row_index: number
  images: UploadedImage[]   // 不限数量，可持续追加
  status: 'filling' | 'ready' | 'submitting' | 'processing' | 'done' | 'failed'
  // 'ready'：至少 1 张图片即可提交，不再要求固定槏位全部填满
}

export interface SubmitRowResult {
  batch_id: string
  row_index: number
  subtask_ids: string[]
}

// ── History Storage types ──

export interface BatchHistoryMeta {
  batch_id: string
  template_id: string         // 保留字段以兼容旧历史记录；新批次写入空字符串
  created_at: number         // Unix timestamp (ms)
  total_count: number
  processed_count: number
  status: 'completed' | 'partial' | 'failed'
  row_count: number
}

export interface BatchHistoryDetail extends BatchHistoryMeta {
  batch_status: BatchStatus
}

export interface StorageQuota {
  used_bytes: number
  limit_bytes: number
  usage_percent: number
  available_bytes: number
}

export class StorageQuotaExceededError extends Error {
  quota: StorageQuota
  constructor(quota: StorageQuota) {
    super('localStorage quota exceeded')
    this.name = 'StorageQuotaExceededError'
    this.quota = quota
  }
}
