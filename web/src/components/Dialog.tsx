import { useEffect, useState } from 'react'

export type DialogType = 'info' | 'success' | 'warning' | 'error' | 'confirm'

export interface DialogConfig {
  type: DialogType
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void
}

interface DialogProps {
  config: DialogConfig
  onClose: (confirmed: boolean) => void
}

const DIALOG_ICONS: Record<DialogType, string> = {
  info: 'ℹ️',
  success: '✓',
  warning: '⚠️',
  error: '✕',
  confirm: '❓',
}

const DIALOG_COLORS: Record<DialogType, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  confirm: 'text-primary',
}

export default function Dialog({ config, onClose }: DialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    setIsOpen(true)
  }, [])

  const handleConfirm = async () => {
    if (isProcessing) return

    setIsProcessing(true)
    try {
      if (config.onConfirm) {
        await config.onConfirm()
      }
      handleClose(true)
    } catch (error) {
      console.error('Dialog onConfirm error:', error)
      setIsProcessing(false)
    }
  }

  const handleCancel = () => {
    if (isProcessing) return

    if (config.onCancel) {
      config.onCancel()
    }
    handleClose(false)
  }

  const handleClose = (confirmed: boolean) => {
    setIsOpen(false)
    setTimeout(() => {
      onClose(confirmed)
    }, 200)
  }

  const showCancel = config.type === 'confirm' || config.cancelText

  return (
    <dialog className={`modal ${isOpen ? 'modal-open' : ''}`}>
      <div className="modal-box">
        <div className="flex items-start gap-4">
          <div className={`text-4xl ${DIALOG_COLORS[config.type]}`}>
            {DIALOG_ICONS[config.type]}
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-lg mb-2">{config.title}</h3>
            <p className="text-sm whitespace-pre-wrap">{config.message}</p>
          </div>
        </div>

        <div className="modal-action">
          {showCancel && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleCancel}
              disabled={isProcessing}
            >
              {config.cancelText || '取消'}
            </button>
          )}
          <button
            type="button"
            className={`btn ${config.type === 'error' ? 'btn-error' : 'btn-primary'}`}
            onClick={handleConfirm}
            disabled={isProcessing}
          >
            {isProcessing && <span className="loading loading-spinner loading-xs" />}
            {config.confirmText || '确定'}
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={handleCancel}>
        <button type="button">关闭</button>
      </div>
    </dialog>
  )
}
