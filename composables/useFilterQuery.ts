type FilterQueryValue = string | number | boolean | null | undefined | Array<string | number>
type FilterQueryState = Record<string, FilterQueryValue>

export function normalizeSearchTerm(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

export function parseAllowedQueryValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const normalized = normalizeSearchTerm(raw)
  return allowed.includes(normalized as T) ? normalized as T : undefined
}

export function parseDateQueryValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const normalized = normalizeSearchTerm(raw)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? normalized
    : undefined
}

export function formatDateFilterLabel(from?: string | null, to?: string | null): string {
  if (from && to) return `日期：${from} 至 ${to}`
  if (from) return `日期：${from} 起`
  return `日期：截至 ${to}`
}

function isActiveFilterValue(value: FilterQueryValue): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'boolean') return value
  return value !== undefined && value !== null && String(value).trim() !== ''
}

export function countActiveFilters(state: FilterQueryState, ignoredKeys: string[] = []): number {
  return Object.entries(state).filter(([key, value]) => !ignoredKeys.includes(key) && isActiveFilterValue(value)).length
}
