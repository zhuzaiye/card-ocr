import { createRoot } from 'react-dom/client'
import Toast from '../components/Toast'
import type { ToastConfig, ToastType, ToastPosition } from '../components/Toast'

export type { ToastConfig, ToastType, ToastPosition }

function showToast(config: ToastConfig): void {
  const container = document.createElement('div')
  container.className = `toast toast-${config.position || 'top-end'}`
  document.body.appendChild(container)

  const root = createRoot(container)

  const handleClose = () => {
    root.unmount()
    document.body.removeChild(container)
  }

  root.render(<Toast config={config} onClose={handleClose} />)
}

export const toast = {
  show(config: ToastConfig): void {
    showToast(config)
  },

  success(message: string, duration?: number): void {
    showToast({
      type: 'success',
      message,
      duration: duration || 3000,
    })
  },

  error(message: string, duration?: number): void {
    showToast({
      type: 'error',
      message,
      duration: duration || 3000,
    })
  },

  warning(message: string, duration?: number): void {
    showToast({
      type: 'warning',
      message,
      duration: duration || 3000,
    })
  },

  info(message: string, duration?: number): void {
    showToast({
      type: 'info',
      message,
      duration: duration || 3000,
    })
  },
}
