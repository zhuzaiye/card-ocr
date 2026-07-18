import { useEffect } from 'react'
import { useHistoryState } from '../hooks/useHistoryState'
import RowResultPanel from './RowResultPanel'
import { dialog } from '../utils/dialog.tsx'
import { toast } from '../utils/toast.tsx'

interface HistoryDetailPanelProps {
  batchId: string
  onBack: () => void
  onBackToHome: () => void
}

export default function HistoryDetailPanel({ batchId, onBack, onBackToHome }: HistoryDetailPanelProps) {
  const { currentDetail, detailLoading, detailError, loadDetail, deleteBatch } = useHistoryState()

  useEffect(() => {
    loadDetail(batchId)
  }, [batchId, loadDetail])

  const handleDelete = async () => {
    const confirmed = await dialog.confirm(
      '确定要删除这个历史批次吗？删除后将无法恢复。',
      '确认删除'
    )
    if (!confirmed) return

    try {
      await deleteBatch(batchId)
      toast.success('历史批次已删除')
      onBack()
    } catch (e) {
      toast.error(`删除失败: ${e instanceof Error ? e.message : '未知错误'}`)
    }
  }

  if (detailLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]" role="status" aria-label="加载中">
        <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
      </div>
    )
  }

  if (detailError || !currentDetail) {
    return (
      <div className="w-full max-w-5xl mx-auto space-y-4">
        <div role="alert" className="alert alert-error">
          <span>{detailError || '批次不存在或已删除'}</span>
        </div>
        <button type="button" className="btn btn-outline" onClick={onBack}>返回历史列表</button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          历史批次详情
          <span className="ml-2 badge badge-lg badge-neutral">只读模式</span>
        </h2>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost btn-sm text-error" onClick={handleDelete}>
            删除此批次
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onBack}>返回列表</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onBackToHome}>返回主页</button>
        </div>
      </div>

      {/* 复用 RowResultPanel，只读模式 */}
      <RowResultPanel
        batchStatus={currentDetail.batch_status}
        onReset={onBack}
        readOnly={true}
      />
    </div>
  )
}
