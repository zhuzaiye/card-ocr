import type { BatchStatus, SubTask } from '../types'

interface Props {
  batchStatus: BatchStatus
}

const STATUS_BADGE: Record<SubTask['status'], string> = {
  pending: 'badge-neutral',
  processing: 'badge-warning',
  completed: 'badge-success',
  failed: 'badge-error',
}

const STATUS_LABEL: Record<SubTask['status'], string> = {
  pending: '等待中',
  processing: '处理中',
  completed: '完成',
  failed: '失败',
}

export default function ProgressPanel({ batchStatus }: Props) {
  const { batch_id, total_count, processed_count, progress_percent, items } = batchStatus

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body gap-4">
        <div className="flex items-center justify-between">
          <h2 className="card-title">识别进行中</h2>
          <span className="loading loading-dots loading-sm text-primary" />
        </div>

        <div className="text-xs text-base-content/50 font-mono break-all">
          批次 ID：{batch_id}
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>进度</span>
            <span>{processed_count} / {total_count}（{progress_percent.toFixed(0)}%）</span>
          </div>
          <progress
            className="progress progress-primary w-full"
            value={progress_percent}
            max={100}
            aria-label={`识别进度 ${progress_percent.toFixed(0)}%`}
          />
        </div>

        <ul className="space-y-1.5">
          {items.map(task => (
            <li
              key={task.subtask_id}
              className="flex items-center justify-between text-sm bg-base-200 rounded-lg px-3 py-2"
            >
              <span className="truncate flex-1 mr-2">{task.filename}</span>
              <span className={`badge badge-sm ${STATUS_BADGE[task.status]}`}>
                {STATUS_LABEL[task.status]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
