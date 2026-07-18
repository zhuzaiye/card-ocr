import { createRoot } from 'react-dom/client'
import Dialog from '../components/Dialog'
import type { DialogConfig, DialogType } from '../components/Dialog'

export type { DialogConfig, DialogType }

function showDialog(config: DialogConfig): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)

    const handleClose = (confirmed: boolean) => {
      resolve(confirmed)
      setTimeout(() => {
        root.unmount()
        document.body.removeChild(container)
      }, 200)
    }

    root.render(<Dialog config={config} onClose={handleClose} />)
  })
}

export const dialog = {
  show(config: DialogConfig): Promise<boolean> {
    return showDialog(config)
  },

  confirm(message: string, title: string = '确认'): Promise<boolean> {
    return showDialog({
      type: 'confirm',
      title,
      message,
      confirmText: '确定',
      cancelText: '取消',
    })
  },

  alert(message: string, type: DialogType = 'info'): Promise<void> {
    return showDialog({
      type,
      title: type === 'error' ? '错误' : type === 'warning' ? '警告' : '提示',
      message,
      confirmText: '确定',
    }).then(() => {})
  },

  success(message: string, title: string = '成功'): Promise<void> {
    return showDialog({
      type: 'success',
      title,
      message,
      confirmText: '确定',
    }).then(() => {})
  },

  warning(message: string, title: string = '警告'): Promise<void> {
    return showDialog({
      type: 'warning',
      title,
      message,
      confirmText: '确定',
    }).then(() => {})
  },

  error(message: string, title: string = '错误'): Promise<void> {
    return showDialog({
      type: 'error',
      title,
      message,
      confirmText: '确定',
    }).then(() => {})
  },
}
