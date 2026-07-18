import type { ApiResponse, BatchStatus, SubmitResult, SubmitRowResult } from './types'

const BASE = '/api/ocr'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json: ApiResponse<T> = await res.json()
  if (json.code !== 0) throw new Error(json.message || '请求失败')
  return json.data as T
}

export async function submitOCR(files: File[], docType: string): Promise<SubmitResult> {
  const form = new FormData()
  files.forEach(f => form.append('files', f))
  form.append('doc_type', docType)
  return request<SubmitResult>(`${BASE}/submit`, { method: 'POST', body: form })
}

export async function getBatchStatus(batchId: string): Promise<BatchStatus> {
  return request<BatchStatus>(`${BASE}/batch-status/${batchId}`)
}

export function downloadBatch(batchId: string): void {
  const a = document.createElement('a')
  a.href = `${BASE}/download/${batchId}`
  a.download = `ocr_result_${batchId}.xlsx`
  a.click()
}

export async function updateSubTaskCard(
  subtaskId: string,
  cardIndex: number,
  data: Record<string, unknown>
): Promise<void> {
  await request<unknown>(`${BASE}/subtask/${subtaskId}/card/${cardIndex}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export async function submitRow(
  batchId: string,
  rowIndex: number,
  images: Array<{ file: File; uniqueName: string; slotIndex: number }>
): Promise<SubmitRowResult> {
  const form = new FormData()
  form.append('batch_id', batchId)
  form.append('row_index', String(rowIndex))
  images.forEach(img => {
    form.append('files', img.file, img.uniqueName)
    form.append('slot_indices', String(img.slotIndex))
  })
  return request<SubmitRowResult>(`${BASE}/submit-row`, { method: 'POST', body: form })
}
