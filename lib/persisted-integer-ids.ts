export type PersistedIntegerIdsIssue =
  | 'invalid_json'
  | 'not_array'
  | 'non_canonical_entry'
  | 'duplicate_entry'
  | 'invalid_entry'

export interface PersistedIntegerIdsResult {
  ids: number[]
  issues: PersistedIntegerIdsIssue[]
}

/**
 * Parse a persisted collection of positive integer ids.
 *
 * Numeric strings are accepted for backwards compatibility but reported as
 * non-canonical so callers can make the repair visible and persist normalized
 * data. Invalid entries are discarded; valid entries are retained and
 * deduplicated instead of losing the entire collection because one value is
 * bad.
 */
export function parsePersistedIntegerIds(
  value: string | null | undefined,
): PersistedIntegerIdsResult {
  if (!value?.trim()) return { ids: [], issues: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { ids: [], issues: ['invalid_json'] }
  }
  if (!Array.isArray(parsed)) return { ids: [], issues: ['not_array'] }

  const ids: number[] = []
  const seen = new Set<number>()
  const issues: PersistedIntegerIdsIssue[] = []
  const report = (issue: PersistedIntegerIdsIssue) => {
    if (!issues.includes(issue)) issues.push(issue)
  }

  for (const rawId of parsed) {
    let id: number
    if (typeof rawId === 'number') {
      id = rawId
    } else if (typeof rawId === 'string' && /^\d+$/.test(rawId)) {
      id = Number(rawId)
      report('non_canonical_entry')
    } else {
      report('invalid_entry')
      continue
    }

    if (!Number.isSafeInteger(id) || id <= 0) {
      report('invalid_entry')
      continue
    }
    if (seen.has(id)) {
      report('duplicate_entry')
      continue
    }
    seen.add(id)
    ids.push(id)
  }

  return { ids, issues }
}

export function serializePersistedIntegerIds(ids: readonly number[]): string | null {
  return ids.length > 0 ? JSON.stringify(ids) : null
}
