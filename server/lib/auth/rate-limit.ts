const MAX_FAILURES = 5
const WINDOW_MS = 60_000
const LOCK_MS = 60_000
export const MAX_RATE_LIMIT_BUCKETS = 4096
interface RateLimitBucket { failures: number; firstFailureAt: number; lockedUntil: number }
const buckets = new Map<string, RateLimitBucket>()

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= Math.max(bucket.firstFailureAt + WINDOW_MS, bucket.lockedUntil)) buckets.delete(key)
  }
}
function denied(seconds: number): Error {
  return Object.assign(new Error(`尝试过于频繁，请 ${seconds} 秒后再试`), { statusCode: 429 })
}
export function assertRateLimit(scope: string, fingerprint: string, now = Date.now()): void {
  sweep(now)
  const bucket = buckets.get(buildKey(scope, fingerprint))
  if (bucket && bucket.lockedUntil > now) throw denied(Math.ceil((bucket.lockedUntil - now) / 1000))
  // Do not evict locked clients when flooded by new source addresses.
  if (!bucket && buckets.size >= MAX_RATE_LIMIT_BUCKETS) throw denied(60)
}
export function recordRateLimitFailure(scope: string, fingerprint: string, now = Date.now()): void {
  sweep(now)
  const key = buildKey(scope, fingerprint)
  const existing = buckets.get(key)
  if (!existing && buckets.size >= MAX_RATE_LIMIT_BUCKETS) return
  const bucket = existing ?? { failures: 0, firstFailureAt: now, lockedUntil: 0 }
  bucket.failures += 1
  if (bucket.failures >= MAX_FAILURES) bucket.lockedUntil = now + LOCK_MS
  buckets.set(key, bucket)
}
export function clearRateLimit(scope: string, fingerprint: string): void { buckets.delete(buildKey(scope, fingerprint)) }
export function clearAllRateLimits(): void { buckets.clear() }
function buildKey(scope: string, fingerprint: string): string { return `${scope}:${fingerprint || 'unknown'}` }
