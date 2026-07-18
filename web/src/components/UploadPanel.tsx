import { useRef, useState } from 'react'
import { submitOCR, getBatchStatus } from '../api'
import type { BatchStatus } from '../types'

interface Props {
  onSubmitSuccess: (status: BatchStatus) => void
  onError: (msg: string) => void
  error: string | null
}

const DOC_TYPES = [
  { value: 'idcard', label: '身份证' },
  { value: 'bankcard', label: '银行卡' },
  { value: 'passport', label: '护照' },
]

export default function UploadPanel({ onSubmitSuccess, onError, error }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [docType, setDocType] = useState('idcard')
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const imgs = Array.from(incoming).filter(f => f.type.startsWith('image/'))
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...imgs.filter(f => !names.has(f.name))]
    })
  }

  const removeFile = (name: string) => setFiles(prev => prev.filter(f => f.name !== name))

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const handleSubmit = async () => {
    if (files.length === 0) {
      onError('请选择文件')
      return
    }
    setLoading(true)
    try {
      const result = await submitOCR(files, docType)
      const status = await getBatchStatus(result.batch_id)
      onSubmitSuccess(status)
    } catch (e) {
      onError(e instanceof Error ? e.message : '提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body gap-4">
        <h2 className="card-title">上传卡证图片</h2>

        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
            ${dragging ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-primary/50'}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => addFiles(e.target.files)}
          />
          <p className="text-base-content/60">
            拖拽图片到此处，或 <span className="text-primary">点击选择</span>
          </p>
          <p className="text-xs text-base-content/40 mt-1">支持 JPG、PNG 等图片格式</p>
        </div>

        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map(f => (
              <li key={f.name} className="flex items-center justify-between text-sm bg-base-200 rounded-lg px-3 py-1.5">
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-error"
                  onClick={e => { e.stopPropagation(); removeFile(f.name) }}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3">
          <label className="label font-medium min-w-max">卡证类型</label>
          <select
            className="select select-bordered select-sm flex-1"
            value={docType}
            onChange={e => setDocType(e.target.value)}
          >
            {DOC_TYPES.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        {error && (
          <div role="alert" className="alert alert-error py-2 text-sm">{error}</div>
        )}

        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? <span className="loading loading-spinner loading-sm" /> : null}
          {loading ? '提交中...' : `提交识别${files.length > 0 ? `（${files.length} 个文件）` : ''}`}
        </button>
      </div>
    </div>
  )
}
