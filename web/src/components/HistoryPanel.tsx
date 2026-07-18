import { useState } from 'react'
import { useHistoryState } from '../hooks/useHistoryState'
import type { BatchHistoryMeta } from '../types'
import { toast } from '../utils/toast.tsx'

interface HistoryPanelProps {
  onViewDetail: (batchId: string) => void
  onBack: () => void
}

function StatusBadge({ status }: { status: BatchHistoryMeta['status'] }) {
  const map: Record<BatchHistoryMeta['status'], { label: string; cls: string }> = {
    completed: { label: '完成', cls: 'badge-success' },
    partial: { label: '部分完成', cls: 'badge-warning' },
    failed: { label: '失败', cls: 'badge-error' },
  }
  const { label, cls } = map[status]
  return <span className={`badge ${cls}`}>{label}</span>
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function HistoryPanel({ onViewDetail, onBack }: HistoryPanelProps) {
  const {
    historyList,
    listLoading,
    listError,
    quota,
    quotaWarning,
    deleteBatch,
    deleteBatches,
    clearQuotaWarning,
  } = useHistoryState()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | string[] | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDeleteOne = (batchId: string) => {
    setDeleteTarget(batchId)
    setDeleteConfirmOpen(true)
  }

  const handleDeleteBatch = () => {
    setDeleteTarget([...selectedIds])
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      if (typeof deleteTarget === 'string') {
        await deleteBatch(deleteTarget)
        toast.success('历史批次已删除')
      } else {
        await deleteBatches(deleteTarget)
        toast.success(`已删除 ${deleteTarget.length} 个历史批次`)
      }
      setSelectedIds(new Set())
      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
    } catch (e) {
      toast.error(`删除失败: ${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setDeleting(false)
    }
  }

  const toggleSelect = (batchId: string) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(batchId)) {
      newSet.delete(batchId)
    } else {
      newSet.add(batchId)
    }
    setSelectedIds(newSet)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === historyList.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(historyList.map(b => b.batch_id)))
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      {/* 容量告警横幅 */}
      {quotaWarning && quota && (
        <div role="alert" className="alert alert-warning shadow-sm">
          <div className="flex-1">
            <span className="font-medium">存储空间告警</span>
            <span className="ml-2 text-sm">
              已使用 {quota.usage_percent.toFixed(0)}%（{(quota.used_bytes / 1024 / 1024).toFixed(1)} MB / {(quota.limit_bytes / 1024 / 1024).toFixed(1)} MB）
            </span>
            <span className="ml-2 text-sm text-base-content/70">建议删除部分历史批次释放空间</span>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={clearQuotaWarning}>知道了</button>
        </div>
      )}

      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          历史记录
          <span className="ml-2 badge badge-lg badge-neutral">{historyList.length} 个批次</span>
        </h2>
        <button type="button" className="btn btn-outline" onClick={onBack}>返回主页</button>
      </div>

      {/* 加载/错误状态 */}
      {listLoading && (
        <div className="flex items-center justify-center py-8">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      )}

      {listError && (
        <div role="alert" className="alert alert-error">
          <span>{listError}</span>
        </div>
      )}

      {/* 批量操作栏 */}
      {!listLoading && historyList.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-base-200 rounded">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={selectedIds.size === historyList.length && historyList.length > 0}
              onChange={toggleSelectAll}
              aria-label="全选"
            />
            <span className="text-sm">全选</span>
          </label>
          {selectedIds.size > 0 && (
            <>
              <span className="text-sm text-base-content/60">已选中 {selectedIds.size} 个批次</span>
              <button type="button" className="btn btn-error btn-sm ml-auto" onClick={handleDeleteBatch}>
                删除选中
              </button>
            </>
          )}
        </div>
      )}

      {/* 空列表提示 */}
      {!listLoading && historyList.length === 0 && (
        <div className="text-center py-12 text-base-content/50">
          暂无历史记录
        </div>
      )}

      {/* 批次列表 */}
      <div className="space-y-3">
        {historyList.map((batch) => (
          <div
            key={batch.batch_id}
            className={`card bg-base-100 shadow-sm border ${selectedIds.has(batch.batch_id) ? 'border-primary' : 'border-base-300'}`}
          >
            <div className="card-body p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm mt-1"
                  checked={selectedIds.has(batch.batch_id)}
                  onChange={() => toggleSelect(batch.batch_id)}
                  aria-label={`选择批次 ${batch.batch_id}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{formatTime(batch.created_at)}</span>
                      <StatusBadge status={batch.status} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onViewDetail(batch.batch_id)}
                      >
                        查看详情
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-error"
                        onClick={() => handleDeleteOne(batch.batch_id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-base-content/60">
                    <span>{batch.row_count} 行</span>
                    <span>{batch.processed_count}/{batch.total_count} 张完成</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 删除确认对话框 */}
      {deleteConfirmOpen && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
          <div className="modal-box">
            <h3 id="delete-dialog-title" className="font-bold text-lg mb-4">确认删除</h3>
            <p className="mb-4">
              {typeof deleteTarget === 'string'
                ? '确定要删除这个批次吗？'
                : `确定要删除选中的 ${(deleteTarget as string[]).length} 个批次吗？`}
            </p>
            <p className="text-sm text-base-content/60 mb-6">删除后将无法恢复，包括所有识别结果和图片。</p>
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : null}
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
