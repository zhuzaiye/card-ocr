import * as XLSX from 'xlsx'
import type { BatchStatus, DetectedCard } from './types'
import { KNOWN_CARD_FIELDS, cardTypeSortIndex } from './types'

/**
 * 动态推导 Excel 列定义：按批次内实际出现过的 card_type 并集生成列，
 * 按 CARD_TYPE_ORDER 优先级排序，保证列顺序在不同行之间保持稳定。
 * 未登记的 card_type（如 'unknown'）不产出字段列，改由"未识别内容"单列汇总原始文本。
 */
function deriveColumns(allCards: DetectedCard[]): { label: string; key: string; card_type: string }[] {
  const seenTypes = new Set<string>()
  for (const card of allCards) {
    if (card.card_type !== 'unknown' && KNOWN_CARD_FIELDS[card.card_type]) {
      seenTypes.add(card.card_type)
    }
  }

  const sortedTypes = [...seenTypes].sort((a, b) => cardTypeSortIndex(a) - cardTypeSortIndex(b))

  const columns: { label: string; key: string; card_type: string }[] = []
  for (const cardType of sortedTypes) {
    for (const f of KNOWN_CARD_FIELDS[cardType]) {
      columns.push({ label: f.label, key: f.key, card_type: cardType })
    }
  }
  return columns
}

export function generateExcelFromBatch(batchStatus: BatchStatus) {
  // 按 row_index 分组，同时收集每行所有 subtask 的 cards
  const rowMap = new Map<number, DetectedCard[]>()
  for (const item of batchStatus.items) {
    const ri = item.row_index ?? 0
    if (!rowMap.has(ri)) rowMap.set(ri, [])
    rowMap.get(ri)!.push(...item.cards)
  }

  const sortedRows = [...rowMap.entries()].sort(([a], [b]) => a - b)

  // 列定义基于批次内全部行的 card_type 并集，保证同一份 Excel 的列在所有行间一致
  const allCards = sortedRows.flatMap(([, cards]) => cards)
  const columns = deriveColumns(allCards)
  const hasUnknown = allCards.some(c => c.card_type === 'unknown')

  const dataRows: Record<string, string>[] = []

  for (const [rowIndex, cards] of sortedRows) {
    // 按 card_type 分组（保持 cardTypeSortIndex 排序顺序）
    const cardsByType = new Map<string, DetectedCard[]>()
    for (const card of cards) {
      if (!cardsByType.has(card.card_type)) cardsByType.set(card.card_type, [])
      cardsByType.get(card.card_type)!.push(card)
    }

    const sortedTypes = [...cardsByType.keys()].sort((a, b) => cardTypeSortIndex(a) - cardTypeSortIndex(b))

    // 计算该行需要展开成几个 Excel 行：同类型多张卡需要分别占一行
    const maxCardsPerType = Math.max(...sortedTypes.map(t => cardsByType.get(t)!.length))
    const rowCount = Math.max(1, maxCardsPerType)

    for (let subRowIdx = 0; subRowIdx < rowCount; subRowIdx++) {
      const row: Record<string, string> = {
        '行序号': subRowIdx === 0 ? String(rowIndex + 1) : '',  // 只在第一个子行显示行号
      }

      for (const col of columns) {
        const cardsOfType = cardsByType.get(col.card_type) ?? []
        const card = cardsOfType[subRowIdx]  // 取该类型的第 N 张卡（可能不存在）
        const value = card?.data?.[col.key]
        row[col.label] = String(value ?? '')
      }

      if (hasUnknown) {
        const unknownCards = cardsByType.get('unknown') ?? []
        const unknownCard = unknownCards[subRowIdx]
        row['未识别内容'] = unknownCard ? (unknownCard.raw_text ?? []).join('; ') : ''
      }

      dataRows.push(row)
    }
  }

  const worksheet = XLSX.utils.json_to_sheet(dataRows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'OCR结果')

  XLSX.writeFile(workbook, `ocr_result_${batchStatus.batch_id}.xlsx`)
}
