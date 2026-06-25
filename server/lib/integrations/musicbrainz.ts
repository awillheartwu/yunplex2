/**
 * Minimal MusicBrainz API client.
 *
 * Only used for artist alias resolution — never for track titles or albums.
 *
 * Features:
 * - artist search with score threshold
 * - locale-aware alias extraction (prefers en, filters noise)
 * - circuit breaker (survives MB outages)
 * - timeouts (never blocks sync for more than 2 s)
 */

// ── Types ──

export interface MusicBrainzArtistAlias {
  name: string
  locale?: string | null
  primary?: boolean
}

export interface MusicBrainzResolveResult {
  matchedName: string | null
  score: number | null
  aliases: MusicBrainzArtistAlias[]
  disambiguation?: string | null
}

interface MbSearchArtist {
  id: string
  name: string
  score: number
  aliases?: Array<{
    name: string
    locale?: string | null
    primary?: boolean
  }>
  disambiguation?: string
}

// ── Config ──

const MB_BASE = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'YunPlex2/1.0 (music-sync; +https://github.com/awillheartwu/reYunPlex)'

let minScore = 90
let requestTimeoutMs = 2000

export function configureMusicBrainz(opts: { minScore?: number; requestTimeoutMs?: number }) {
  if (opts.minScore !== undefined) minScore = opts.minScore
  if (opts.requestTimeoutMs !== undefined) requestTimeoutMs = opts.requestTimeoutMs
}

// ── Circuit breaker ──

type BreakerState = 'closed' | 'open' | 'half-open'

interface Breaker {
  state: BreakerState
  consecutiveFailures: number
  openedAt: number | null
}

const breaker: Breaker = { state: 'closed', consecutiveFailures: 0, openedAt: null }
const FAILURE_THRESHOLD = 5
const OPEN_DURATION_MS = 10 * 60 * 1000 // 10 min

function breakerAllows(): boolean {
  if (breaker.state === 'closed') return true
  if (breaker.state === 'open' && breaker.openedAt) {
    if (Date.now() - breaker.openedAt >= OPEN_DURATION_MS) {
      breaker.state = 'half-open'
      return true // allow 1 probe
    }
    return false
  }
  if (breaker.state === 'half-open') return true
  return true
}

function breakerSuccess() {
  breaker.consecutiveFailures = 0
  breaker.state = 'closed'
  breaker.openedAt = null
}

function breakerFailure() {
  breaker.consecutiveFailures++
  if (breaker.consecutiveFailures >= FAILURE_THRESHOLD) {
    breaker.state = 'open'
    breaker.openedAt = Date.now()
  }
}

export function getBreakerState(): BreakerState { return breaker.state }

// ── API ──

/**
 * Search MusicBrainz for an artist and return useful English aliases.
 * Returns null when MB is unavailable or no quality match is found.
 */
export async function resolveArtist(artistName: string): Promise<MusicBrainzResolveResult | null> {
  if (!breakerAllows()) return null

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs)

    const url = `${MB_BASE}/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=3`
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) breakerFailure()
      return null
    }

    const data = (await res.json()) as { artists?: MbSearchArtist[] }
    const artists = data.artists ?? []
    if (artists.length === 0) {
      breakerSuccess()
      return { matchedName: null, score: null, aliases: [] }
    }

    const top = artists[0]!
    if (top.score < minScore) {
      breakerSuccess()
      return { matchedName: null, score: null, aliases: [] }
    }

    // Build alias list: filter, deduplicate
    const seen = new Set<string>()
    seen.add(normalizeAliasKey(artistName))

    const aliases: MusicBrainzArtistAlias[] = []

    // Add the matched name itself if it differs from input
    if (normalizeAliasKey(top.name) !== normalizeAliasKey(artistName)) {
      aliases.push({ name: top.name, locale: null, primary: false })
      seen.add(normalizeAliasKey(top.name))
    }

    // Add aliases from the search result, preferring en/non-locale Latin
    for (const al of top.aliases ?? []) {
      const key = normalizeAliasKey(al.name)
      if (seen.has(key)) continue
      if (key === normalizeAliasKey(artistName)) continue

      // Accept: en locale, or Latin-script with no locale, or primary=true
      const isLatin = /^[a-zA-Z\s'\-."!&/,()]+$/.test(al.name.trim())
      const accept = al.locale === 'en' || (isLatin && !al.locale) || al.primary
      if (!accept) continue

      seen.add(key)
      aliases.push({ name: al.name.trim(), locale: al.locale ?? null, primary: al.primary ?? false })
    }

    breakerSuccess()
    return {
      matchedName: top.name,
      score: top.score,
      aliases,
      disambiguation: top.disambiguation,
    }
  } catch {
    breakerFailure()
    return null
  }
}

function normalizeAliasKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').trim()
}
