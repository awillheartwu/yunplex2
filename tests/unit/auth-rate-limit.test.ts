import { afterEach, expect, it } from 'vitest'
import { assertRateLimit, recordRateLimitFailure, clearAllRateLimits, MAX_RATE_LIMIT_BUCKETS } from '../../server/lib/auth/rate-limit'
afterEach(clearAllRateLimits)
it('locks failures, expires cold entries, and keeps capacity bounded without evicting locks', () => {
  for (let i = 0; i < 5; i++) recordRateLimitFailure('login', 'locked', 1000)
  expect(() => assertRateLimit('login', 'locked', 1001)).toThrow()
  for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS + 10; i++) recordRateLimitFailure('login', `ip-${i}`, 1000)
  expect(() => assertRateLimit('login', 'new', 1001)).toThrow()
  expect(() => assertRateLimit('login', 'locked', 1001)).toThrow()
  expect(() => assertRateLimit('login', 'new', 61000)).not.toThrow()
})
