import { useEffect, useState } from 'react'

export type ToastType = 'info' | 'success' | 'warning' | 'error'
export type ToastPosition = 'top-start' | 'top-center' | 'top-end' | 'bottom-start' | 'bottom-center' | 'bottom-end'

export interface ToastConfig {
  type: ToastType
  message: string
  duration?: number
  position?: ToastPosition
}

interface ToastProps {
  config: ToastConfig
  onClose: () => void
}

const TOAST_ALERTS: Record<ToastType, string> = {
  info: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
  error: 'alert-error',
}

const TOAST_ICONS: Record<ToastType, string> = {
  info: 'ℹ️',
  success: '✓',
  warning: '⚠️',
  error: '✕',
}

export default function Toast({ config, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setIsVisible(true)

    const timer = setTimeout(() => {
      handleClose()
    }, config.duration || 3000)

    return () => clearTimeout(timer)
  }, [config.duration])

  const handleClose = () => {
    setIsVisible(false)
    setTimeout(onClose, 200)
  }

  return (
    <div
      className={`alert ${TOAST_ALERTS[config.type]} shadow-lg transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">{TOAST_ICONS[config.type]}</span>
        <span className="text-sm">{config.message}</span>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-circle"
        onClick={handleClose}
        aria-label="关闭"
      >
        ✕
      </button>
    </div>
  )
}
