import { useState, useEffect, useRef } from 'react'
import type { BatchStatus } from './types'
import RowUploadPanel from './components/RowUploadPanel'
import RowResultPanel from './components/RowResultPanel'
import HistoryPanel from './components/HistoryPanel'
import HistoryDetailPanel from './components/HistoryDetailPanel'
import { HistoryStorage } from './historyStorage'

type ViewState = 'uploading' | 'streaming' | 'done' | 'history' | 'history-detail'

const BATCH_ID_KEY = 'card_ocr_batch_id'

function loadOrCreateBatchId(): string {
  const existing = localStorage.getItem(BATCH_ID_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(BATCH_ID_KEY, id)
  return id
}

export default function App() {
  const [viewState, setViewState] = useState<ViewState>('uploading')
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string>(loadOrCreateBatchId)
  const eventSourceRef = useRef<EventSource | null>(null)

  // 历史导航状态
  const [selectedHistoryBatchId, setSelectedHistoryBatchId] = useState<string | null>(null)
  const [previousViewState, setPreviousViewState] = useState<ViewState | null>(null)

  // 警告弹窗状态
  const [showWarningModal, setShowWarningModal] = useState(false)

  const stopStreaming = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopStreaming()
    }
  }, [])

  const startStreaming = (bid: string) => {
    if (eventSourceRef.current) return

    const eventSource = new EventSource(`/api/ocr/stream/${bid}`)

    eventSource.onmessage = (event) => {
      try {
        const data: BatchStatus = JSON.parse(event.data)

        if ('error' in data) {
          setError('批次不存在或已过期')
          stopStreaming()
          setViewState('done')
          return
        }

        setBatchStatus(data)

        if (data.status === 'completed') {
          stopStreaming()
          setViewState('done')
        }
      } catch {
        setError('数据解析失败')
        stopStreaming()
        setViewState('done')
      }
    }

    eventSource.onerror = () => {
      setError('连接中断，请刷新页面重试')
      stopStreaming()
      setViewState('done')
    }

    eventSourceRef.current = eventSource
  }

  const handleFirstRowSubmitted = (bid: string) => {
    setViewState('streaming')
    startStreaming(bid)
  }

  // 清理函数
  function clearBatchImages(bId: string | null) {
    if (!bId) return

    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`img_${bId}_`)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
  }

  // 开启一个全新批次（不需要用户预先选模版，直接可以上传）
  function startNewBatch() {
    stopStreaming()
    clearBatchImages(batchId)
    const newBatchId = crypto.randomUUID()
    localStorage.setItem(BATCH_ID_KEY, newBatchId)
    setBatchId(newBatchId)
    setBatchStatus(null)
    setError(null)
    setViewState('uploading')
  }

  // 结果页返回
  const handleBackFromResults = () => {
    setShowWarningModal(true)
  }

  const handleWarningSave = () => {
    if (batchStatus) {
      try {
        HistoryStorage.saveBatchToHistory(batchStatus)
        // 注意：不删除图片，保留给历史记录使用
      } catch {
        // 静默失败
      }
    }
    // 清理 batch_id 和状态，但保留图片
    stopStreaming()
    const newBatchId = crypto.randomUUID()
    localStorage.setItem(BATCH_ID_KEY, newBatchId)
    setBatchId(newBatchId)
    setBatchStatus(null)
    setError(null)
    setViewState('uploading')
    setShowWarningModal(false)
  }

  const handleWarningDiscard = () => {
    // 用户选择不保存，清理包括图片在内的所有数据
    startNewBatch()
    setShowWarningModal(false)
  }

  // 历史导航回调
  const handleViewHistory = () => {
    setPreviousViewState(viewState)
    setViewState('history')
  }

  const handleClearAll = () => {
    // 清除上传页面所有已填写但未提交的数据（不创建新 batch_id）
    clearBatchImages(batchId)
    // 触发 RowUploadPanel 重置（通过 key prop 强制重新挂载）
    setBatchId(prev => prev) // 保持相同 batch_id，只是清除图片
    window.location.reload() // 简单粗暴：刷新页面重置所有 UI 状态
  }

  const handleViewDetail = (historyBatchId: string) => {
    setSelectedHistoryBatchId(historyBatchId)
    setViewState('history-detail')
  }

  const handleBackFromDetail = () => {
    setSelectedHistoryBatchId(null)
    setViewState('history')
  }

  const handleBackToHome = () => {
    setSelectedHistoryBatchId(null)
    if (previousViewState) {
      setViewState(previousViewState)
      setPreviousViewState(null)
    } else {
      setViewState('uploading')
    }
  }

  const isHistoryMode = viewState === 'history' || viewState === 'history-detail'

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      <header className="navbar bg-base-100 shadow-sm px-6">
        <div className="flex-1">
          <span className="text-xl font-bold">卡证 OCR 识别系统</span>
        </div>
        <div className="flex-none gap-2">
          {viewState === 'uploading' && (
            <button
              type="button"
              className="btn btn-error btn-outline btn-sm"
              onClick={handleClearAll}
              title="清除所有已填写但未提交的数据"
            >
              🗑️ 全部清除
            </button>
          )}
          {!isHistoryMode && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleViewHistory}
            >
              📋 历史记录
            </button>
          )}
        </div>
      </header>

      <div role="alert" className="alert alert-error rounded-none justify-center text-center py-2 px-4">
        <span className="text-sm font-medium">
          ⚠️ 本系统所有数据均不会在后端保存，仅在您本地浏览器临时存在；目前仅支持身份证、银行卡的识别处理
        </span>
      </div>

      <main className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-3xl">
          {viewState === 'history' && (
            <HistoryPanel
              onViewDetail={handleViewDetail}
              onBack={handleBackToHome}
            />
          )}

          {viewState === 'history-detail' && selectedHistoryBatchId && (
            <HistoryDetailPanel
              batchId={selectedHistoryBatchId}
              onBack={handleBackFromDetail}
              onBackToHome={handleBackToHome}
            />
          )}

          {!isHistoryMode && (
            <>
              {error && viewState === 'uploading' && (
                <div role="alert" className="alert alert-error mb-4 text-sm">{error}</div>
              )}

              {(viewState === 'uploading' || viewState === 'streaming') && (
                <div className="space-y-4">
                  <RowUploadPanel
                    batchId={batchId}
                    onFirstRowSubmitted={handleFirstRowSubmitted}
                  />
                  {viewState === 'streaming' && batchStatus && (
                    <div className="card bg-base-100 shadow-sm">
                      <div className="card-body p-4 gap-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            识别进行中 <span className="loading loading-dots loading-xs text-primary" />
                          </span>
                          <span>{batchStatus.processed_count} / {batchStatus.total_count}</span>
                        </div>
                        <progress
                          className="progress progress-primary w-full"
                          value={batchStatus.progress_percent}
                          max={100}
                          aria-label={`识别进度 ${batchStatus.progress_percent.toFixed(0)}%`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {viewState === 'done' && batchStatus && (
                <RowResultPanel
                  batchStatus={batchStatus}
                  onReset={handleBackFromResults}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* Warning Modal */}
      {showWarningModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">保存历史记录</h3>
            <p className="py-4">是否保存本次批次到浏览器历史？</p>
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowWarningModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleWarningDiscard}
              >
                不保存
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleWarningSave}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
