import { useRef, useState } from 'react'
import { submitRow } from '../api'
import type { RowEntry, UploadedImage } from '../types'

interface Props {
  batchId: string
  onFirstRowSubmitted: (batchId: string) => void
}

function makeEmptyRow(rowIndex: number): RowEntry {
  return {
    row_index: rowIndex,
    status: 'filling',
    images: [],
  }
}

interface RowCardProps {
  row: RowEntry
  onAddImage: (file: File) => void
  onRemoveImage: (imageIdx: number) => void
  onSubmit: () => void
  onDelete: () => void
  submitting: boolean
}

function RowCard({ row, onAddImage, onRemoveImage, onSubmit, onDelete, submitting }: RowCardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const locked = row.status !== 'filling' && row.status !== 'ready'
  const canSubmit = row.images.length > 0 && !locked

  const statusLabel: Record<RowEntry['status'], string> = {
    filling: '',
    ready: '',
    submitting: '提交中...',
    processing: '识别中',
    done: '完成',
    failed: '失败',
  }

  return (
    <div className={`card bg-base-100 shadow-sm border ${row.status === 'done' ? 'border-success/40' : row.status === 'failed' ? 'border-error/40' : 'border-base-300'}`}>
      <div className="card-body p-3 gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium opacity-60">第 {row.row_index + 1} 条</span>
          <div className="flex items-center gap-2">
            {statusLabel[row.status] && (
              <span className={`text-xs ${row.status === 'done' ? 'text-success' : row.status === 'failed' ? 'text-error' : 'text-base-content/60'}`}>
                {statusLabel[row.status]}
              </span>
            )}
            {!locked && (
              <button
                className="btn btn-ghost btn-xs text-error opacity-60 hover:opacity-100"
                onClick={onDelete}
                title="删除此行"
              >✕</button>
            )}
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          {row.images.map((img, idx) => (
            <div key={idx} className="flex flex-col gap-1 items-center">
              <div
                className="w-28 h-20 rounded border-2 border-solid border-success/60 bg-success/5 flex items-center justify-center overflow-hidden relative group"
              >
                {img.preview ? (
                  <img src={img.preview} alt={img.uniqueName} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-success text-lg">✓</span>
                )}
                {!locked && (
                  <button
                    className="absolute top-0 right-0 btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 bg-black/40 text-white hover:bg-black/60"
                    onClick={() => onRemoveImage(idx)}
                    title="移除"
                  >✕</button>
                )}
              </div>
            </div>
          ))}

          {!locked && (
            <div
              className="w-28 h-20 rounded border-2 border-dashed border-base-300 flex flex-col items-center justify-center cursor-pointer text-xs text-center gap-1 hover:border-primary hover:bg-primary/5"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="opacity-60 text-lg">+</span>
              <span className="opacity-40">添加图片</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0] ?? null
              if (file) onAddImage(file)
              e.target.value = ''
            }}
            disabled={locked}
          />
        </div>

        {!locked && (
          <button
            className="btn btn-primary btn-sm self-end"
            disabled={!canSubmit || submitting}
            onClick={onSubmit}
          >
            {submitting ? '提交中...' : '提交识别'}
          </button>
        )}
      </div>
    </div>
  )
}

// ---- RowUploadPanel ----

export default function RowUploadPanel({ batchId, onFirstRowSubmitted }: Props) {
  const [rows, setRows] = useState<RowEntry[]>([makeEmptyRow(0)])
  const [submittingRow, setSubmittingRow] = useState<number | null>(null)
  const firstRowSubmitted = useRef(false)

  function handleAddImage(rowIdx: number, file: File) {
    // eslint-disable-next-line react-hooks/purity
    const timestamp = Date.now()
    // eslint-disable-next-line react-hooks/purity
    const randomStr = Math.random().toString(36).substring(2, 10)
    const ext = file.name.split('.').pop() || 'jpg'
    const uniqueName = `${timestamp}_${randomStr}.${ext}`

    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = reader.result as string

      setRows(prev => prev.map((r) => {
        if (r.row_index !== rowIdx) return r
        const slotIndex = r.images.length
        const key = `img_${batchId}_${rowIdx}_${slotIndex}`
        localStorage.setItem(key, base64)

        const newImage: UploadedImage = { slot_index: slotIndex, file, uniqueName, preview: base64 }
        return { ...r, images: [...r.images, newImage], status: 'ready' as const }
      }))
    }
    reader.readAsDataURL(file)
  }

  function handleRemoveImage(rowIdx: number, imageIdx: number) {
    setRows(prev => prev.map((r) => {
      if (r.row_index !== rowIdx) return r
      const removed = r.images[imageIdx]
      if (removed) {
        localStorage.removeItem(`img_${batchId}_${rowIdx}_${removed.slot_index}`)
      }
      const images = r.images.filter((_, i) => i !== imageIdx)
      return { ...r, images, status: images.length > 0 ? 'ready' as const : 'filling' as const }
    }))
  }

  function handleDeleteRow(rowIdx: number) {
    setRows(prev => {
      const filtered = prev.filter((_, i) => i !== rowIdx)
      return filtered.map((r, i) => ({ ...r, row_index: i }))
    })
  }

  async function handleSubmitRow(rowIdx: number) {
    const row = rows[rowIdx]
    if (!row || row.images.length === 0) return
    setSubmittingRow(rowIdx)
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, status: 'submitting' as const } : r))

    try {
      const imagesToSubmit = row.images.map(img => ({
        file: img.file,
        uniqueName: img.uniqueName,
        slotIndex: img.slot_index,
      }))

      await submitRow(batchId, row.row_index, imagesToSubmit)

      setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, status: 'processing' as const } : r))

      if (!firstRowSubmitted.current) {
        firstRowSubmitted.current = true
        onFirstRowSubmitted(batchId)
      }
    } catch {
      setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, status: 'failed' as const } : r))
    } finally {
      setSubmittingRow(null)
    }
  }

  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <RowCard
          key={row.row_index}
          row={row}
          onAddImage={(file) => handleAddImage(row.row_index, file)}
          onRemoveImage={(imageIdx) => handleRemoveImage(row.row_index, imageIdx)}
          onSubmit={() => handleSubmitRow(i)}
          onDelete={() => handleDeleteRow(i)}
          submitting={submittingRow === i}
        />
      ))}
      <button
        type="button"
        className="btn btn-outline btn-block btn-sm"
        onClick={() => {
          const nextIdx = Math.max(...rows.map(r => r.row_index)) + 1
          setRows(prev => [...prev, makeEmptyRow(nextIdx)])
        }}
      >
        ➕ 手动增加下一条
      </button>
    </div>
  )
}
