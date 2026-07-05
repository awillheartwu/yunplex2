const MAX_FAILURES = 5
const WINDOW_MS = 60_000
const LOCK_MS = 60_000

interface RateLimitBucket {
  failures: number
  firstFailureAt: number
  lockedUntil: number
}

const buckets = new Map<string, RateLimitBucket>()

export function assertRateLimit(scope: string, fingerprint: string, now = Date.now()): void {
  const key = buildKey(scope, fingerprint)
  const bucket = buckets.get(key)
  if (!bucket) return
  if (bucket.lockedUntil > now) {
    const seconds = Math.ceil((bucket.lockedUntil - now) / 1000)
    throw new Error(`尝试过于频繁，请 ${seconds} 秒后再试`)
  }
  if (now - bucket.firstFailureAt > WINDOW_MS) {
    buckets.delete(key)
  }
}

export function recordRateLimitFailure(scope: string, fingerprint: string, now = Date.now()): void {
  const key = buildKey(scope, fingerprint)
  const existing = buckets.get(key)
  const bucket = existing && now - existing.firstFailureAt <= WINDOW_MS
    ? existing
    : { failures: 0, firstFailureAt: now, lockedUntil: 0 }

  bucket.failures += 1
  if (bucket.failures >= MAX_FAILURES) {
    bucket.lockedUntil = now + LOCK_MS
  }
  buckets.set(key, bucket)
}

export function clearRateLimit(scope: string, fingerprint: string): void {
  buckets.delete(buildKey(scope, fingerprint))
}

export function clearAllRateLimits(): void {
  buckets.clear()
}

function buildKey(scope: string, fingerprint: string): string {
  return `${scope}:${fingerprint || 'unknown'}`
}
