/** Shared page-window math for the unified footer. Pure data only, so components, composables and tests agree on one definition. */

export type PageItem =
  | { type: 'page'; page: number }
  | { type: 'ellipsis'; key: string }

export interface PageRange {
  from: number
  to: number
}

/** Number of page buttons the footer renders before ellipses replace the rest. */
export const PAGE_WINDOW_SIZE = 7

export function pageCount(total: number, pageSize: number): number {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const count = Math.ceil(Math.max(0, Math.floor(total) || 0) / size)
  return Math.max(1, count)
}

export function clampPage(page: number, totalPages: number): number {
  const total = Math.max(1, Math.floor(totalPages) || 1)
  const candidate = Math.floor(page)
  if (!Number.isFinite(candidate) || candidate < 1) return 1
  return Math.min(candidate, total)
}

function pageNumbers(start: number, end: number): PageItem[] {
  const items: PageItem[] = []
  for (let value = start; value <= end; value += 1) items.push({ type: 'page', page: value })
  return items
}

/**
 * Keeps the first and last page reachable while a large page count collapses into
 * a bounded window: edge runs near the start or end, otherwise first / previous /
 * current / next / last with ellipses for the skipped ranges.
 */
export function buildPageItems(page: number, totalPages: number, maxItems = PAGE_WINDOW_SIZE): PageItem[] {
  const total = Math.max(1, Math.floor(totalPages) || 1)
  const current = clampPage(page, total)
  const budget = Math.max(5, Math.floor(maxItems) || PAGE_WINDOW_SIZE)
  if (total <= budget) return pageNumbers(1, total)

  const edgeRun = budget - 2
  const innerRun = budget - 4
  const edgeLimit = edgeRun - 1
  if (current <= edgeLimit) {
    return [...pageNumbers(1, edgeRun), { type: 'ellipsis', key: 'ellipsis-end' }, { type: 'page', page: total }]
  }
  if (current >= total - edgeLimit + 1) {
    return [{ type: 'page', page: 1 }, { type: 'ellipsis', key: 'ellipsis-start' }, ...pageNumbers(total - edgeRun + 1, total)]
  }
  const innerStart = current - Math.floor((innerRun - 1) / 2)
  return [
    { type: 'page', page: 1 },
    { type: 'ellipsis', key: 'ellipsis-start' },
    ...pageNumbers(innerStart, innerStart + innerRun - 1),
    { type: 'ellipsis', key: 'ellipsis-end' },
    { type: 'page', page: total },
  ]
}

export function pageRange(page: number, pageSize: number, total: number): PageRange {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const count = Math.max(0, Math.floor(total) || 0)
  if (count === 0) return { from: 0, to: 0 }
  const current = clampPage(page, pageCount(count, size))
  return { from: (current - 1) * size + 1, to: Math.min(current * size, count) }
}

export function pageRangeLabel(page: number, pageSize: number, total: number): string {
  const { from, to } = pageRange(page, pageSize, total)
  return `第 ${from}–${to} 项，共 ${Math.max(0, Math.floor(total) || 0)} 项`
}
