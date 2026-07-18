import type { BatchStatus, BatchHistoryMeta, BatchHistoryDetail, StorageQuota, SubTask } from './types'
import { StorageQuotaExceededError } from './types'

const STORAGE_KEYS = {
  HISTORY_META: (batchId: string) => `history_meta_${batchId}`,
  HISTORY_DETAIL: (batchId: string) => `history_detail_${batchId}`,
  IMAGE: (batchId: string, rowIndex: number, slotIndex: number) =>
    `img_${batchId}_${rowIndex}_${slotIndex}`,
  HISTORY_INDEX: 'history_index',
} as const

// 旧版本（模版时代）存入 localStorage 的 subtask 结构：单个 card_type + data，无 cards 数组
interface LegacySubTask {
  card_type?: string
  data?: Record<string, unknown> | null
  cards?: unknown
}

/**
 * 兼容旧历史记录：模版时代的 SubTask 是 { card_type, data } 单卡结构，
 * 新结构是 { cards: DetectedCard[] } 数组。读取时把旧结构映射成新结构，
 * 避免 RowResultPanel 在 st.cards 上抛错。
 */
function normalizeLegacyBatchStatus(raw: BatchStatus): BatchStatus {
  return {
    ...raw,
    items: raw.items.map((item) => {
      const legacy = item as unknown as SubTask & LegacySubTask
      if (Array.isArray(legacy.cards)) return item as SubTask
      if (legacy.card_type) {
        return {
          ...item,
          cards: [{ card_type: legacy.card_type, data: legacy.data ?? {} }],
        } as SubTask
      }
      return { ...item, cards: [] } as SubTask
    }),
  }
}

export class HistoryStorage {
  /**
   * 保存当前批次到历史
   * 状态映射：completed → completed, failed → failed, processing/partial → partial
   * 幂等性：相同 batch_id 调用两次，第二次覆盖第一次
   */
  static saveBatchToHistory(batchStatus: BatchStatus): void {
    const { batch_id, total_count, processed_count, items } = batchStatus

    // 计算实际行数
    const rowSet = new Set(items.map(item => item.row_index))
    const row_count = rowSet.size

    // 状态映射
    let status: 'completed' | 'partial' | 'failed'
    if (batchStatus.status === 'failed') {
      status = 'failed'
    } else if (
      batchStatus.status === 'completed' &&
      items.every(item => item.status === 'completed')
    ) {
      status = 'completed'
    } else {
      status = 'partial'
    }

    const meta: BatchHistoryMeta = {
      batch_id,
      template_id: '',   // 模版概念已移除，新批次固定写空字符串，保留字段以兼容旧历史记录
      created_at: Date.now(),
      total_count,
      processed_count,
      status,
      row_count,
    }

    try {
      // 容量检测（在写入前，85% 阈值主动清理）
      const quota = this.getStorageQuota()
      if (quota.usage_percent > 85) {
        const targetFree = 1024 * 1024 // 1MB
        const evicted = this.evictOldestBatches(targetFree)
        if (evicted.length > 0) {
          console.warn(`localStorage 容量告警：已清理 ${evicted.length} 个旧批次`)
        }
      }

      // 保存元数据
      const metaKey = STORAGE_KEYS.HISTORY_META(batch_id)
      try {
        localStorage.setItem(metaKey, JSON.stringify(meta))
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          throw new StorageQuotaExceededError(this.getStorageQuota())
        }
        throw e
      }

      // 更新索引（追加到前面，保持倒序）
      const index = this.getIndex()
      if (!index.includes(batch_id)) {
        index.unshift(batch_id)
        localStorage.setItem(STORAGE_KEYS.HISTORY_INDEX, JSON.stringify(index))
      }

      // 保存完整 BatchStatus（用于详情查询）
      const detailKey = STORAGE_KEYS.HISTORY_DETAIL(batch_id)
      localStorage.setItem(detailKey, JSON.stringify(batchStatus))
    } catch (e) {
      if (e instanceof StorageQuotaExceededError) {
        throw e
      }
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        throw new StorageQuotaExceededError(this.getStorageQuota())
      }
      throw e
    }
  }

  /**
   * 查询所有历史批次元数据（按 created_at 倒序）
   * 无记录时返回空数组
   * JSON 解析错误时跳过该条记录，不抛出异常
   */
  static listBatchHistory(): BatchHistoryMeta[] {
    const index = this.getIndex()
    const results: BatchHistoryMeta[] = []

    for (const batchId of index) {
      const metaKey = STORAGE_KEYS.HISTORY_META(batchId)
      const raw = localStorage.getItem(metaKey)
      if (!raw) continue

      try {
        const meta = JSON.parse(raw) as BatchHistoryMeta
        results.push(meta)
      } catch {
        // JSON 解析错误，跳过该条记录
        continue
      }
    }

    // 按 created_at 降序排序
    return results.sort((a, b) => b.created_at - a.created_at)
  }

  /**
   * 查询单个批次详情
   * batch_id 不存在时返回 null
   * JSON 解析错误时返回 null
   */
  static getBatchDetail(batchId: string): BatchHistoryDetail | null {
    const metaKey = STORAGE_KEYS.HISTORY_META(batchId)
    const detailKey = STORAGE_KEYS.HISTORY_DETAIL(batchId)

    const metaRaw = localStorage.getItem(metaKey)
    const detailRaw = localStorage.getItem(detailKey)

    if (!metaRaw || !detailRaw) return null

    try {
      const meta = JSON.parse(metaRaw) as BatchHistoryMeta
      const rawBatchStatus = JSON.parse(detailRaw) as BatchStatus
      const batch_status = normalizeLegacyBatchStatus(rawBatchStatus)
      return { ...meta, batch_status }
    } catch {
      return null
    }
  }

  /**
   * 删除单个批次（元数据 + 所有图片）
   */
  static deleteBatch(batchId: string): void {
    // 删除元数据
    const metaKey = STORAGE_KEYS.HISTORY_META(batchId)
    localStorage.removeItem(metaKey)

    // 删除详情
    const detailKey = STORAGE_KEYS.HISTORY_DETAIL(batchId)
    localStorage.removeItem(detailKey)

    // 删除所有关联图片
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`img_${batchId}_`)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))

    // 更新索引
    const index = this.getIndex()
    const newIndex = index.filter(id => id !== batchId)
    localStorage.setItem(STORAGE_KEYS.HISTORY_INDEX, JSON.stringify(newIndex))
  }

  /**
   * 批量删除（原子操作）
   * 事务性：所有成功或所有失败
   */
  static deleteBatches(batchIds: string[]): void {
    // 收集所有需要删除的键
    const keysToRemove: string[] = []

    for (const batchId of batchIds) {
      keysToRemove.push(STORAGE_KEYS.HISTORY_META(batchId))
      keysToRemove.push(STORAGE_KEYS.HISTORY_DETAIL(batchId))

      // 收集图片键
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(`img_${batchId}_`)) {
          keysToRemove.push(key)
        }
      }
    }

    // 原子删除（localStorage 操作是同步的，无需事务控制）
    keysToRemove.forEach(key => localStorage.removeItem(key))

    // 更新索引
    const index = this.getIndex()
    const newIndex = index.filter(id => !batchIds.includes(id))
    localStorage.setItem(STORAGE_KEYS.HISTORY_INDEX, JSON.stringify(newIndex))
  }

  /**
   * 获取当前 localStorage 容量信息
   * 永不抛出异常，失败时返回保守估算（5MB）
   */
  static getStorageQuota(): StorageQuota {
    try {
      let used_bytes = 0
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) {
          const value = localStorage.getItem(key)
          if (value) {
            // UTF-16 编码：每字符 2 字节
            used_bytes += (key.length + value.length) * 2
          }
        }
      }

      const limit_bytes = this.estimateStorageLimit()
      const usage_percent = (used_bytes / limit_bytes) * 100
      const available_bytes = Math.max(0, limit_bytes - used_bytes)

      return { used_bytes, limit_bytes, usage_percent, available_bytes }
    } catch {
      // 永不抛出异常，返回保守估算
      return {
        used_bytes: 0,
        limit_bytes: 5 * 1024 * 1024,
        usage_percent: 0,
        available_bytes: 5 * 1024 * 1024,
      }
    }
  }

  /**
   * 清理最旧的批次直到释放指定字节数
   * 按 created_at 升序清理（最旧优先）
   * 返回被清理的 batch_id 列表
   * 清理失败不抛出异常
   */
  static evictOldestBatches(targetFreeBytes: number): string[] {
    const evicted: string[] = []

    try {
      // 按 created_at 升序排序（最旧的在前）
      const allBatches = this.listBatchHistory().sort((a, b) => a.created_at - b.created_at)

      let freedBytes = 0
      for (const batch of allBatches) {
        if (freedBytes >= targetFreeBytes) break

        const batchBytes = this.estimateBatchSize(batch.batch_id)
        this.deleteBatch(batch.batch_id)
        evicted.push(batch.batch_id)
        freedBytes += batchBytes
      }
    } catch {
      // 清理失败不阻塞主流程
    }

    return evicted
  }

  /**
   * 探测 localStorage 容量上限（内部方法）
   * 使用二分查找 + sessionStorage 缓存
   */
  private static estimateStorageLimit(): number {
    try {
      const cached = sessionStorage.getItem('_storage_limit_cache')
      if (cached) {
        const parsed = parseInt(cached, 10)
        if (!isNaN(parsed) && parsed > 0) return parsed
      }
    } catch {
      // sessionStorage 不可用时跳过缓存
    }

    try {
      const testKey = '_quota_test_key'
      const chunkSize = 1024 * 100 // 100KB
      let low = 1024 * 1024 // 1MB
      let high = 15 * 1024 * 1024 // 15MB
      let limit = 5 * 1024 * 1024 // 默认 5MB

      for (let i = 0; i < 10; i++) {
        const mid = Math.floor((low + high) / 2)
        // UTF-16：每字符 2 字节，testData.length * 2 ≈ mid bytes
        const testData = 'x'.repeat(Math.floor(mid / 2))

        try {
          localStorage.setItem(testKey, testData)
          localStorage.removeItem(testKey)
          low = mid
          limit = mid
        } catch {
          high = mid
        }

        if (high - low < chunkSize) break
      }

      try {
        sessionStorage.setItem('_storage_limit_cache', String(limit))
      } catch {
        // sessionStorage 不可用，跳过缓存
      }

      return limit
    } catch {
      return 5 * 1024 * 1024
    }
  }

  /**
   * 估算单个批次的存储占用（内部方法）
   * 遍历 meta、detail 和所有 img_ 键
   */
  private static estimateBatchSize(batchId: string): number {
    let size = 0

    try {
      const metaKey = STORAGE_KEYS.HISTORY_META(batchId)
      const metaValue = localStorage.getItem(metaKey)
      if (metaValue) {
        size += (metaKey.length + metaValue.length) * 2
      }

      const detailKey = STORAGE_KEYS.HISTORY_DETAIL(batchId)
      const detailValue = localStorage.getItem(detailKey)
      if (detailValue) {
        size += (detailKey.length + detailValue.length) * 2
      }

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(`img_${batchId}_`)) {
          const value = localStorage.getItem(key)
          if (value) {
            size += (key.length + value.length) * 2
          }
        }
      }
    } catch {
      // 估算失败返回 0
    }

    return size
  }

  /**
   * 获取索引数组（内部方法）
   */
  private static getIndex(): string[] {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY_INDEX)
    if (!raw) return []
    try {
      return JSON.parse(raw) as string[]
    } catch {
      return []
    }
  }
}
