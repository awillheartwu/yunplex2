import type { Ref } from 'vue'

export type FilterQueryValue = string | number | boolean | null | undefined | Array<string | number>
export type FilterQueryState = Record<string, FilterQueryValue>

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

export function isActiveFilterValue(value: FilterQueryValue): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'boolean') return value
  return value !== undefined && value !== null && String(value).trim() !== ''
}

export function countActiveFilters(state: FilterQueryState, ignoredKeys: string[] = []): number {
  return Object.entries(state).filter(([key, value]) => !ignoredKeys.includes(key) && isActiveFilterValue(value)).length
}

export function serializeFilterQuery(state: FilterQueryState): Record<string, string> {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(state)) {
    if (!isActiveFilterValue(value)) continue
    if (Array.isArray(value)) query[key] = value.map(String).join(',')
    else if (typeof value === 'boolean') query[key] = value ? '1' : '0'
    else query[key] = normalizeSearchTerm(value)
  }
  return query
}

export function parseFilterQuery<T extends FilterQueryState>(
  query: Record<string, unknown>,
  defaults: T,
  arrayKeys: string[] = [],
  booleanKeys: string[] = [],
): T {
  const parsed: FilterQueryState = { ...defaults }
  for (const key of Object.keys(defaults)) {
    const raw = query[key]
    if (raw === undefined || raw === null) continue
    const value = Array.isArray(raw) ? raw[0] : raw
    if (arrayKeys.includes(key)) {
      parsed[key] = String(value).split(',').map(v => v.trim()).filter(Boolean)
    } else if (booleanKeys.includes(key)) {
      parsed[key] = value === '1' || value === 'true'
    } else {
      parsed[key] = normalizeSearchTerm(value)
    }
  }
  return parsed as T
}

export function useQueryBackedFilters<T extends FilterQueryState>(
  defaults: T,
  options: { arrayKeys?: string[]; booleanKeys?: string[]; ignoredActiveKeys?: string[] } = {},
) {
  const route = useRoute()
  const router = useRouter()
  const filters = ref(parseFilterQuery(route.query, defaults, options.arrayKeys, options.booleanKeys)) as Ref<T>

  function replaceQuery(next: T) {
    const serialized = serializeFilterQuery(next)
    router.replace({ query: { ...route.query, ...Object.fromEntries(Object.keys(defaults).map(k => [k, undefined])), ...serialized } })
  }

  function patchFilter(partial: Partial<T>) {
    filters.value = { ...filters.value, ...partial }
    replaceQuery(filters.value)
  }

  function clearFilters() {
    filters.value = { ...defaults }
    replaceQuery(filters.value)
  }

  const activeCount = computed(() => countActiveFilters(filters.value, options.ignoredActiveKeys))

  return { filters, activeCount, patchFilter, clearFilters }
}
