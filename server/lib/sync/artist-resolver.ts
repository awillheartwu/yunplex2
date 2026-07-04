/**
 * Central artist-name resolution pipeline.
 *
 * For every Netease artist name we produce a priority-ordered list of
 * candidate search terms that Plex might recognise.  The resolver
 * combines four sources:
 *
 *   1. original name
 *   2. manual aliases  (cfg.other.artistAliases — user-curated)
 *   3. MusicBrainz     (english / romanised aliases)
 *   4. script conversion (simplified ↔ traditional Chinese)
 *
 * Two-layer cache (memory + SQLite) with TTL-aware reads.
 * Circuit breaker in the MB client, not here.
 */
import { tify, sify } from 'chinese-conv'
import { getDb } from '../db'
import { resolveArtist as mbResolve } from '../integrations/musicbrainz'
import type { MusicBrainzResolveResult } from '../integrations/musicbrainz'

// ── Types ──

export type ArtistCandidateSource =
  | 'original'
  | 'manual-alias'
  | 'musicbrainz'
  | 'script-conversion'

export interface ArtistCandidate {
  name: string
  normalizedName: string
  source: ArtistCandidateSource
  confidence: number
  locale?: string | null
  isPrimary?: boolean
}

export interface ResolvedArtist {
  input: string
  normalizedInput: string
  candidates: ArtistCandidate[]
  cacheHit: boolean
  mbQueried: boolean
}

type CacheStatus = 'success' | 'empty' | 'failed' | 'disabled'

// ── Config ──

let manualAliases: Record<string, string> = {}
let enableMB = true
let mbMinScore = 90
let mbTimeout = 2000

export function configureResolver(opts: {
  manualAliases?: Record<string, string>
  enableMB?: boolean
  mbMinScore?: number
  mbTimeout?: number
}) {
  const changed =
    (opts.manualAliases && opts.manualAliases !== manualAliases) ||
    (opts.enableMB !== undefined && opts.enableMB !== enableMB) ||
    (opts.mbMinScore !== undefined && opts.mbMinScore !== mbMinScore)

  if (opts.manualAliases) manualAliases = opts.manualAliases
  if (opts.enableMB !== undefined) enableMB = opts.enableMB
  if (opts.mbMinScore !== undefined) mbMinScore = opts.mbMinScore
  if (opts.mbTimeout !== undefined) mbTimeout = opts.mbTimeout

  // Config change → invalidate all caches so new aliases / MB toggle / score
  // threshold take effect immediately instead of waiting for TTL expiry.
  if (changed) {
    memoryCache.clear()
    try {
      getDb().prepare('DELETE FROM artist_resolution_cache').run()
    } catch { /* best-effort */ }
  }

  import('../integrations/musicbrainz').then((m) =>
    m.configureMusicBrainz({ minScore: mbMinScore, requestTimeoutMs: mbTimeout }),
  )
}

// ── Cache helpers ──

function normalizeKey(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, '').trim()
}

function cacheTTL(status: CacheStatus): number {
  switch (status) {
    case 'success':  return 24 * 3600 * 1000      // 24h
    case 'empty':    return 6 * 3600 * 1000       // 6h — genuinely no aliases on MB
    case 'failed':   return 15 * 60 * 1000        // 15min — transient MB outage
    case 'disabled': return 60 * 60 * 1000        // 1h — MB off or score too low; user may re-enable/lower threshold
  }
}

// ── Memory cache ──

interface MemEntry {
  resolved: ResolvedArtist
  expiresAt: number
}

const memoryCache = new Map<string, MemEntry>()

// ── SQLite cache ──

interface DiskRow {
  resolved_json: string
  last_status: CacheStatus
  updated_at: string
}

/**
 * Read from SQLite, honouring TTL based on last_status.
 * Returns { resolved, status } or null when absent / expired / unreadable.
 */
function dbGet(key: string): { resolved: ResolvedArtist; status: CacheStatus } | null {
  try {
    const db = getDb()
    const row = db
      .prepare('SELECT resolved_json, last_status, updated_at FROM artist_resolution_cache WHERE normalized_name = ?')
      .get(key) as DiskRow | undefined
    if (!row) return null

    // TTL check: expired rows are deleted and treated as cache miss
    const age = Date.now() - new Date(row.updated_at).getTime()
    const ttl = cacheTTL(row.last_status)
    if (age > ttl) {
      db.prepare('DELETE FROM artist_resolution_cache WHERE normalized_name = ?').run(key)
      return null
    }

    return { resolved: JSON.parse(row.resolved_json) as ResolvedArtist, status: row.last_status }
  } catch {
    return null
  }
}

/**
 * Upsert into SQLite.  Keyed on normalized_name (PK).
 */
function dbPut(key: string, resolved: ResolvedArtist, status: CacheStatus, mbScore: number | null = null) {
  try {
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO artist_resolution_cache (normalized_name, original_name, resolved_json, source, confidence,
        mb_score, last_status, failure_count, last_attempt_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_name) DO UPDATE SET
        original_name = excluded.original_name,
        resolved_json = excluded.resolved_json,
        source = excluded.source,
        confidence = excluded.confidence,
        mb_score = excluded.mb_score,
        last_status = excluded.last_status,
        failure_count = artist_resolution_cache.failure_count + (CASE WHEN excluded.last_status = 'failed' THEN 1 ELSE 0 END),
        last_attempt_at = excluded.last_attempt_at,
        updated_at = excluded.updated_at
    `).run(
      key, resolved.input, JSON.stringify(resolved),
      primarySource(resolved), maxConfidence(resolved),
      mbScore,
      status,
      now,
      now,
    )
  } catch { /* non-critical; cache is best-effort */ }
}

function primarySource(r: ResolvedArtist): string {
  return r.candidates.find((c) => c.source !== 'original')?.source ?? 'original'
}

function maxConfidence(r: ResolvedArtist): number {
  return r.candidates.reduce((max, c) => Math.max(max, c.confidence), 0)
}

// ── Resolution pipeline ──

export async function resolveArtistCandidates(artistName: string): Promise<ResolvedArtist> {
  const key = normalizeKey(artistName)

  // 1) memory cache
  const mem = memoryCache.get(key)
  if (mem && mem.expiresAt > Date.now()) {
    return { ...mem.resolved, cacheHit: true, mbQueried: false }
  }

  // 2) SQLite cache (TTL-aware — dbGet deletes expired rows)
  const diskResult = dbGet(key)
  if (diskResult) {
    memoryCache.set(key, {
      resolved: diskResult.resolved,
      expiresAt: Date.now() + cacheTTL(diskResult.status),
    })
    return { ...diskResult.resolved, cacheHit: true, mbQueried: false }
  }

  // 3) build candidates
  const seen = new Set<string>()
  const candidates: ArtistCandidate[] = []
  let mbQueried = false
  let mbHadError = false
  let mbResult: MusicBrainzResolveResult | null = null

  function add(name: string, source: ArtistCandidateSource, confidence: number, locale?: string | null, isPrimary?: boolean) {
    const nKey = normalizeKey(name)
    if (seen.has(nKey)) return
    seen.add(nKey)
    candidates.push({ name, normalizedName: normalizeForCompare(name), source, confidence, locale, isPrimary })
  }

  // 3a) original
  add(artistName, 'original', 60)

  // 3b) manual alias
  const alias = manualAliases[artistName]
  if (alias && normalizeKey(alias) !== key) {
    add(alias, 'manual-alias', 100)
  }

  // 3c) MusicBrainz
  if (enableMB) {
    mbResult = await mbResolve(artistName)
    mbQueried = true
    if (mbResult === null) {
      mbHadError = true // MB unreachable / timed out / breaker open
    } else if (mbResult.aliases.length > 0) {
      for (const al of mbResult.aliases) {
        if (al.name && normalizeKey(al.name) !== key) {
          add(al.name, 'musicbrainz', 80, al.locale, al.primary)
        }
      }
    }
    // else: MB returned empty (no aliases) — not an error, just no data
  }

  // 3d) script conversion — only when candidates are sparse
  const hasEnoughCandidates = candidates.length >= 3 && !mbHadError
  if (!hasEnoughCandidates) {
    const s2tName = tify(artistName)
    if (s2tName !== artistName && !seen.has(normalizeKey(s2tName))) {
      add(s2tName, 'script-conversion', 40)
    }
    const t2sName = sify(artistName)
    if (t2sName !== artistName && !seen.has(normalizeKey(t2sName))) {
      add(t2sName, 'script-conversion', 40)
    }
  }

  // Sort: confidence desc, original first among equals
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    if (a.source === 'original') return -1
    if (b.source === 'original') return 1
    return 0
  })

  // ── Classify status ──
  let status: CacheStatus
  let score: number | null = null
  if (mbHadError) {
    status = 'failed'       // transient MB outage → 15min TTL
  } else if (candidates.length > 1) {
    status = 'success'      // got aliases → 24h TTL
  } else if (!enableMB || !mbQueried) {
    status = 'disabled'     // MB off → 1h TTL (user may re-enable)
  } else {
    status = 'empty'        // MB queried, genuinely no aliases → 6h TTL
  }

  const resolved: ResolvedArtist = { input: artistName, normalizedInput: key, candidates, cacheHit: false, mbQueried }

  memoryCache.set(key, { resolved, expiresAt: Date.now() + cacheTTL(status) })
  if (mbResult) score = mbResult.score
  dbPut(key, resolved, status, score)

  return resolved
}

function normalizeForCompare(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Return flat candidate name list, ordered by priority. */
export function candidateNames(resolved: ResolvedArtist): string[] {
  return resolved.candidates.map((c) => c.name)
}
