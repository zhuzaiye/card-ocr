import { useState, useEffect, useCallback } from 'react'
import { HistoryStorage } from '../historyStorage'
import type { BatchHistoryMeta, BatchHistoryDetail, StorageQuota } from '../types'

interface HistoryState {
  // 列表状态
  historyList: BatchHistoryMeta[]
  listLoading: boolean
  listError: string | null

  // 详情状态
  currentDetail: BatchHistoryDetail | null
  detailLoading: boolean
  detailError: string | null

  // 容量状态
  quota: StorageQuota | null
  quotaWarning: boolean

  // 操作方法
  refreshList: () => void
  loadDetail: (batchId: string) => void
  deleteBatch: (batchId: string) => Promise<void>
  deleteBatches: (batchIds: string[]) => Promise<void>
  clearQuotaWarning: () => void
}

export function useHistoryState(): HistoryState {
  // 列表状态
  const [historyList, setHistoryList] = useState<BatchHistoryMeta[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  // 详情状态
  const [currentDetail, setCurrentDetail] = useState<BatchHistoryDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // 容量状态
  const [quota, setQuota] = useState<StorageQuota | null>(null)
  const [quotaWarning, setQuotaWarning] = useState(false)

  // 刷新容量信息（内部方法）
  const refreshQuota = useCallback(() => {
    try {
      const q = HistoryStorage.getStorageQuota()
      setQuota(q)
      setQuotaWarning(q.usage_percent > 80)
    } catch {
      // getStorageQuota 应该永不抛出异常，但防御性处理
      setQuota(null)
      setQuotaWarning(false)
    }
  }, [])

  // 刷新列表
  const refreshList = useCallback(() => {
    setListLoading(true)
    setListError(null)

    try {
      const list = HistoryStorage.listBatchHistory()
      setHistoryList(list)
    } catch (e) {
      setListError(e instanceof Error ? e.message : '加载历史列表失败')
      setHistoryList([])
    } finally {
      setListLoading(false)
    }
  }, [])

  // 加载详情
  const loadDetail = useCallback((batchId: string) => {
    setDetailLoading(true)
    setDetailError(null)

    try {
      const detail = HistoryStorage.getBatchDetail(batchId)
      if (!detail) {
        setDetailError('批次不存在或已删除')
        setCurrentDetail(null)
      } else {
        setCurrentDetail(detail)
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '加载批次详情失败')
      setCurrentDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // 删除单个批次
  const deleteBatch = useCallback(async (batchId: string): Promise<void> => {
    try {
      HistoryStorage.deleteBatch(batchId)

      // 如果删除的是当前详情，清空详情状态
      setCurrentDetail(prev => (prev?.batch_id === batchId ? null : prev))

      // 自动刷新列表和容量
      refreshList()
      refreshQuota()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '删除批次失败'
      setListError(msg)
      throw e // 抛出给 UI 层显示 toast/alert
    }
  }, [refreshList, refreshQuota])

  // 批量删除
  const deleteBatches = useCallback(async (batchIds: string[]): Promise<void> => {
    try {
      HistoryStorage.deleteBatches(batchIds)

      // 如果删除的包含当前详情，清空详情状态
      setCurrentDetail(prev => (prev && batchIds.includes(prev.batch_id) ? null : prev))

      // 自动刷新列表和容量
      refreshList()
      refreshQuota()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '批量删除失败'
      setListError(msg)
      throw e
    }
  }, [refreshList, refreshQuota])

  // 清除容量告警（用户点击"知道了"）
  const clearQuotaWarning = useCallback(() => {
    setQuotaWarning(false)
  }, [])

  // 初始化：自动加载列表和容量
  useEffect(() => {
    // Load list on mount
    /* eslint-disable react-hooks/set-state-in-effect */
    setListLoading(true)
    try {
      const list = HistoryStorage.listBatchHistory()
      setHistoryList(list)
    } catch (e) {
      setListError(e instanceof Error ? e.message : '加载历史列表失败')
      setHistoryList([])
    } finally {
      setListLoading(false)
    }

    // Load quota on mount
    try {
      const q = HistoryStorage.getStorageQuota()
      setQuota(q)
      setQuotaWarning(q.usage_percent > 80)
    } catch {
      setQuota(null)
      setQuotaWarning(false)
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []) // mount-only effect

  return {
    historyList,
    listLoading,
    listError,
    currentDetail,
    detailLoading,
    detailError,
    quota,
    quotaWarning,
    refreshList,
    loadDetail,
    deleteBatch,
    deleteBatches,
    clearQuotaWarning,
  }
}
