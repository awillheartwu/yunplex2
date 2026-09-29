type PlainRecord = Record<string, unknown>

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge partial configuration objects without retaining deleted artist aliases.
 * All ordinary configuration records merge recursively; arrays and primitives
 * replace the corresponding base value.
 */
export function deepMerge<T extends object>(base: T, partial: Partial<T>, path = ''): T {
  const result = { ...base } as PlainRecord
  const baseRecord = base as PlainRecord

  for (const key of Object.keys(partial)) {
    const value = (partial as PlainRecord)[key]
    const childPath = path ? `${path}.${key}` : key

    if (Array.isArray(value)) {
      // Arrays represent complete settings collections, so a patch replaces
      // the previous collection instead of merging entries by index.
      result[key] = value
    } else if (isPlainRecord(value)) {
      result[key] = childPath === 'other.artistAliases'
        ? { ...value }
        : deepMerge(
            isPlainRecord(baseRecord[key]) ? baseRecord[key] : {},
            value,
            childPath,
          )
    } else if (value !== undefined) {
      result[key] = value
    }
  }

  return result as T
}
