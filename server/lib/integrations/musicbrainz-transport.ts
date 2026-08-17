const MUSICBRAINZ_USER_AGENT = 'YunPlex2/1.0 (music-sync; +https://github.com/awillheartwu/reYunPlex)'
const FAILURE_THRESHOLD = 5
const OPEN_DURATION_MS = 10 * 60 * 1000

export type MusicBrainzBreakerState = 'closed' | 'open' | 'half-open'
export type MusicBrainzTransportFailureReason =
  | 'circuit_open'
  | 'not_found'
  | 'timeout'
  | 'network_error'
  | `http_${number}`

export type MusicBrainzTransportResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number | null; reason: MusicBrainzTransportFailureReason }

const breaker = {
  state: 'closed' as MusicBrainzBreakerState,
  consecutiveFailures: 0,
  openedAt: null as number | null,
}

let requestTimeoutMs = 2000
let requestIntervalMs = 1000
let nextRequestAt = 0

export function configureMusicBrainzTransport(options: {
  requestTimeoutMs?: number
  requestIntervalMs?: number
}): void {
  if (options.requestTimeoutMs !== undefined) requestTimeoutMs = Math.max(0, options.requestTimeoutMs)
  if (options.requestIntervalMs !== undefined) requestIntervalMs = Math.max(0, options.requestIntervalMs)
}

export function getMusicBrainzBreakerState(): MusicBrainzBreakerState {
  return breaker.state
}

export function musicBrainzTransportAvailable(): boolean {
  if (breaker.state === 'closed' || breaker.state === 'half-open') return true
  if (breaker.openedAt !== null && Date.now() - breaker.openedAt >= OPEN_DURATION_MS) {
    breaker.state = 'half-open'
    return true
  }
  return false
}

function recordSuccess(): void {
  breaker.state = 'closed'
  breaker.consecutiveFailures = 0
  breaker.openedAt = null
}

function recordFailure(): void {
  breaker.consecutiveFailures += 1
  if (breaker.consecutiveFailures >= FAILURE_THRESHOLD) {
    breaker.state = 'open'
    breaker.openedAt = Date.now()
  }
}

async function waitForRateLimit(): Promise<void> {
  const now = Date.now()
  const delay = Math.max(0, nextRequestAt - now)
  nextRequestAt = Math.max(nextRequestAt, now) + requestIntervalMs
  if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay))
}

/**
 * The single MusicBrainz HTTP seam. Every endpoint shares rate limiting,
 * timeout, user-agent, circuit-breaker accounting, and stable failure reasons.
 */
export async function fetchMusicBrainzJson(url: string): Promise<MusicBrainzTransportResult> {
  if (!musicBrainzTransportAvailable()) {
    return { ok: false, status: null, reason: 'circuit_open' }
  }

  await waitForRateLimit()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT },
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) recordFailure()
      return {
        ok: false,
        status: response.status,
        reason: response.status === 404 ? 'not_found' : `http_${response.status}`,
      }
    }
    const body = await response.json()
    recordSuccess()
    return { ok: true, status: response.status, body }
  } catch (error) {
    recordFailure()
    return {
      ok: false,
      status: null,
      reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error',
    }
  } finally {
    clearTimeout(timer)
  }
}
