import { useState } from 'react'
import { updateSubTaskCard } from '../api'
import { generateExcelFromBatch } from '../excelGenerator'
import type { BatchStatus, SubTask, DetectedCard } from '../types'
import { KNOWN_CARD_FIELDS } from '../types'
import { toast } from '../utils/toast.tsx'
import { dialog } from '../utils/dialog.tsx'

interface Props {
  batchStatus: BatchStatus
  onReset: () => void
  readOnly?: boolean
}

const CARD_LABELS: Record<string, string> = {
  idcard_front: '📄 身份证正面',
  idcard_back: '📄 身份证反面',
  bankcard: '💳 银行卡',
  passport: '🛂 护照',
  unknown: '❓ 未识别卡证',
}

function cardLabel(cardType: string): string {
  return CARD_LABELS[cardType] || `📄 ${cardType}`
}

function UnknownCardRow({
  card,
  cardIndex,
  subtaskId,
  imageSrc,
  isLast,
  onDelete,
  readOnly = false,
}: {
  card: DetectedCard
  cardIndex: number
  subtaskId: string
  imageSrc: string | null
  isLast: boolean
  onDelete: (subtaskId: string, cardIndex: number) => Promise<void>
  readOnly?: boolean
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    const confirmed = await dialog.confirm('确定删除这张未识别卡证吗？删除后无法恢复。', '确认删除')
    if (!confirmed) return
    setDeleting(true)
    try {
      await onDelete(subtaskId, cardIndex)
    } catch (e) {
      toast.error(`删除失败: ${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={`grid grid-cols-[280px_1fr] ${!isLast ? 'border-b border-base-300' : ''}`}>
      <div className="bg-base-200/50 border-r border-base-300 flex flex-col items-center justify-center p-4 gap-2">
        {imageSrc ? (
          <img src={imageSrc} alt="未识别卡证" className="object-contain rounded max-h-[200px] max-w-full" />
        ) : (
          <div className="text-xs text-base-content/40">图片未加载</div>
        )}
      </div>
      <div className="flex flex-col bg-base-100">
        <div className="flex items-center justify-between px-4 py-2 bg-base-200 border-b border-base-300">
          <h4 className="font-medium text-sm">{cardLabel('unknown')}</h4>
          {!readOnly && (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-error"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <span className="loading loading-spinner loading-xs" /> : '🗑'} 删除
            </button>
          )}
        </div>
        <div className="px-4 py-3 space-y-1">
          <p className="text-xs text-base-content/60 mb-2">未匹配任何已知卡证类型，以下为原始识别文本供人工核对：</p>
          {(card.raw_text ?? []).length > 0 ? (
            (card.raw_text ?? []).map((line, i) => (
              <div key={i} className="text-sm text-base-content">{line}</div>
            ))
          ) : (
            <div className="text-sm text-base-content/40">（无原始文本）</div>
          )}
        </div>
      </div>
    </div>
  )
}

function CardResultRow({
  card,
  cardIndex,
  subtaskId,
  imageSrc,
  onSave,
  onDelete,
  isLast,
  readOnly = false,
}: {
  card: DetectedCard
  cardIndex: number
  subtaskId: string
  imageSrc: string | null
  onSave: (subtaskId: string, cardIndex: number, data: Record<string, unknown>) => Promise<void>
  onDelete: (subtaskId: string, cardIndex: number) => Promise<void>
  isLast: boolean
  readOnly?: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedData, setEditedData] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [rotation, setRotation] = useState(0)

  const handleRotate = (e: React.MouseEvent) => {
    e.stopPropagation()
    setRotation(prev => (prev + 90) % 360)
  }

  const fields = KNOWN_CARD_FIELDS[card.card_type] ?? []
  const label = cardLabel(card.card_type)

  const handleEdit = () => {
    if (readOnly) return
    setEditedData({ ...card.data })
    setIsEditing(true)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditedData({})
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(subtaskId, cardIndex, editedData)
      setIsEditing(false)
    } catch (e) {
      toast.error(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await dialog.confirm(`确定删除这张"${label}"吗？删除后无法恢复。`, '确认删除')
    if (!confirmed) return
    setDeleting(true)
    try {
      await onDelete(subtaskId, cardIndex)
    } catch (e) {
      toast.error(`删除失败: ${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setDeleting(false)
    }
  }

  const handleCopy = () => {
    const text = fields.map(f => `${f.label}: ${card.data?.[f.key] ?? ''}`).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      toast.success('已复制到剪贴板')
    }).catch(() => {
      toast.error('复制失败')
    })
  }

  const currentData = isEditing ? editedData : card.data || {}

  return (
    <div className={`grid grid-cols-[280px_1fr] ${!isLast ? 'border-b border-base-300' : ''}`}>

      {/* 左列：图片（跨越标题行和内容区，高度自动撑满） */}
      <div className="bg-base-200/50 border-r border-base-300 flex flex-col items-center justify-center p-4 gap-2">
        {imageSrc ? (
          <>
            <div className="cursor-pointer group relative w-full flex items-center justify-center overflow-hidden" onClick={() => setModalOpen(true)}>
              <img
                src={imageSrc}
                alt={label}
                className="object-contain rounded max-h-[200px] transition-transform duration-300"
                style={{ transform: `rotate(${rotation}deg)`, maxWidth: rotation % 180 !== 0 ? '160px' : '100%' }}
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center gap-2">
                <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/50 px-2 py-1 rounded">
                  🔍 放大
                </span>
                <span
                  className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/50 px-2 py-1 rounded cursor-pointer"
                  onClick={handleRotate}
                >
                  ↻ 旋转
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-base-content/40">图片未加载</div>
        )}
      </div>

      {/* 右列：标题行 + 字段（垂直排列） */}
      <div className="flex flex-col bg-base-100">
        {/* 标题行（与内容区同宽） */}
        <div className="flex items-center justify-between px-4 py-2 bg-base-200 border-b border-base-300">
          <h4 className="font-medium text-sm">{label}</h4>
          <div className="flex gap-2">
            {!readOnly && !isEditing ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopy}>📋 复制</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleEdit}>✏ 编辑</button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-error"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? <span className="loading loading-spinner loading-xs" /> : '🗑'} 删除
                </button>
              </>
            ) : !readOnly && isEditing ? (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? <span className="loading loading-spinner loading-xs" /> : '✓'} 保存
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleCancel} disabled={saving}>
                  ✕ 取消
                </button>
              </>
            ) : (
              // 只读模式：只显示复制按钮
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopy}>📋 复制</button>
            )}
          </div>
        </div>

        {/* 字段列表（每行一个字段） */}
        <div className="px-4 py-3 space-y-2">
          {fields.map((field) => {
            const value = currentData[field.key]
            return (
              <div key={field.key} className="flex items-center gap-3">
                <span className="text-sm font-medium text-base-content/60 w-24 flex-shrink-0">
                  {field.label}
                </span>
                {isEditing ? (
                  <input
                    type="text"
                    className="input input-bordered input-sm flex-1"
                    value={String(value ?? '')}
                    onChange={(e) => setEditedData((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                ) : (
                  <span className="text-sm text-base-content flex-1">{String(value ?? '')}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 图片放大 Modal */}
      {modalOpen && imageSrc && (
        <div className="modal modal-open col-span-2" onClick={() => setModalOpen(false)}>
          <div className="modal-box max-w-5xl h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-4 border-b border-base-300">
              <h3 className="font-bold text-lg">{label}</h3>
              <div className="flex items-center gap-2">
                <button type="button" className="btn btn-outline btn-sm gap-1" onClick={handleRotate}>
                  ↻ 旋转
                </button>
                <button type="button" className="btn btn-sm btn-circle btn-ghost" onClick={() => setModalOpen(false)}>✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto my-4 flex items-center justify-center bg-base-200 rounded">
              <img
                src={imageSrc}
                alt={label}
                className="max-h-full max-w-full transition-transform duration-300"
                style={{ transform: `rotate(${rotation}deg)` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RowCard({
  rowIndex,
  subtasks,
  batchId,
  onSave,
  onDelete,
  readOnly = false,
}: {
  rowIndex: number
  subtasks: SubTask[]
  batchId: string
  onSave: (subtaskId: string, cardIndex: number, data: Record<string, unknown>) => Promise<void>
  onDelete: (subtaskId: string, cardIndex: number) => Promise<void>
  readOnly?: boolean
}) {
  const allDone = subtasks.every(s => s.status === 'completed')
  const anyFailed = subtasks.some(s => s.status === 'failed')
  const totalCards = subtasks.reduce((sum, s) => sum + s.cards.length, 0)
  const completedCards = subtasks.filter(s => s.status === 'completed').reduce((sum, s) => sum + s.cards.length, 0)

  // 按 slot_index 排序，确保显示顺序正确
  const sortedSubtasks = [...subtasks].sort((a, b) => a.slot_index - b.slot_index)

  // 展开每个 subtask 的 cards 数组：每张卡优先展示自己的裁剪图，没有裁剪图（如旧历史记录）时回退整图
  const flatCards = sortedSubtasks.flatMap(st => {
    const imageKey = `img_${batchId}_${rowIndex}_${st.slot_index}`
    const wholeImageSrc = localStorage.getItem(imageKey)
    return st.cards.map((card, cardIndex) => {
      const imageSrc = card.cropped_image_b64
        ? `data:image/jpeg;base64,${card.cropped_image_b64}`
        : wholeImageSrc
      return { card, cardIndex, subtaskId: st.subtask_id, imageSrc }
    })
  })

  return (
    <div className="border border-base-300 rounded-lg overflow-hidden">
      {/* 行标题 */}
      <div className="flex items-center justify-between px-4 py-3 bg-base-200 border-b border-base-300">
        <h3 className="font-semibold text-base">
          第 {rowIndex + 1} 行 ({completedCards}/{totalCards} 张卡完成)
        </h3>
        <span className={`badge ${allDone ? 'badge-success' : anyFailed ? 'badge-error' : 'badge-neutral'}`}>
          {allDone ? '完成 ✓' : anyFailed ? '部分失败' : '识别中'}
        </span>
      </div>
      {/* 每张检测出的卡证作为一行 */}
      {flatCards.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-base-content/40">该行卡证已全部删除</div>
      ) : flatCards.map(({ card, cardIndex, subtaskId, imageSrc }, idx) => (
        card.card_type === 'unknown' ? (
          <UnknownCardRow
            key={`${subtaskId}-${cardIndex}`}
            card={card}
            cardIndex={cardIndex}
            subtaskId={subtaskId}
            imageSrc={imageSrc}
            isLast={idx === flatCards.length - 1}
            onDelete={onDelete}
            readOnly={readOnly}
          />
        ) : (
          <CardResultRow
            key={`${subtaskId}-${cardIndex}`}
            card={card}
            cardIndex={cardIndex}
            subtaskId={subtaskId}
            imageSrc={imageSrc}
            onSave={onSave}
            onDelete={onDelete}
            isLast={idx === flatCards.length - 1}
            readOnly={readOnly}
          />
        )
      ))}
    </div>
  )
}

export default function RowResultPanel({ batchStatus, onReset, readOnly = false }: Props) {
  const [bsLocal, setBsLocal] = useState(batchStatus)
  const [downloading, setDownloading] = useState(false)

  const rowMap = new Map<number, SubTask[]>()
  for (const item of bsLocal.items) {
    const ri = item.row_index ?? 0
    if (!rowMap.has(ri)) rowMap.set(ri, [])
    rowMap.get(ri)!.push(item)
  }
  const sortedRows = [...rowMap.entries()].sort(([a], [b]) => a - b)

  const allRowsDone = sortedRows.every(([, sts]) => sts.every(s => s.status === 'completed' || s.status === 'failed'))

  const handleSave = async (subtaskId: string, cardIndex: number, data: Record<string, unknown>) => {
    await updateSubTaskCard(subtaskId, cardIndex, data)
    setBsLocal(prev => ({
      ...prev,
      items: prev.items.map(t => {
        if (t.subtask_id !== subtaskId) return t
        const cards = t.cards.map((c, i) => i === cardIndex ? { ...c, data: { ...c.data, ...data } } : c)
        return { ...t, cards }
      }),
    }))
  }

  // 纯前端删除：只影响当前结果页展示、后续 Excel 导出和保存历史，不回写后端内存
  // （后端内存 30 分钟 TTL 后自动清理，SSE 流已关闭不会再重新拉取，删除后无需同步）
  const handleDelete = async (subtaskId: string, cardIndex: number) => {
    setBsLocal(prev => ({
      ...prev,
      items: prev.items.map(t => {
        if (t.subtask_id !== subtaskId) return t
        const cards = t.cards.filter((_, i) => i !== cardIndex)
        return { ...t, cards }
      }),
    }))
    toast.success('已删除')
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      generateExcelFromBatch(bsLocal)
      toast.success('Excel 文件已生成')
    } catch (e) {
      toast.error(`下载失败: ${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      {sortedRows.map(([rowIndex, subtasks]) => (
        <RowCard key={rowIndex} rowIndex={rowIndex} subtasks={subtasks} batchId={bsLocal.batch_id} onSave={handleSave} onDelete={handleDelete} readOnly={readOnly} />
      ))}
      <div className="flex gap-2 pt-2">
        {!readOnly && allRowsDone && (
          <button type="button" className="btn btn-primary flex-1" onClick={handleDownload} disabled={downloading}>
            {downloading ? <span className="loading loading-spinner loading-sm" /> : null}
            {downloading ? '生成中...' : '校对完成，下载 Excel'}
          </button>
        )}
        <button type="button" className="btn btn-outline flex-1" onClick={onReset}>
          {readOnly ? '返回' : '返回重新上传'}
        </button>
      </div>
    </div>
  )
}
