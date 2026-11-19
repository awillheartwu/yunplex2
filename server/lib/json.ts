/** Parse persisted JSON without allowing a corrupt row to break a read path. */
export function parseJsonOr<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/** Parse a persisted JSON object, rejecting arrays and primitive values. */
export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  const parsed = parseJsonOr<unknown>(value, null)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}
