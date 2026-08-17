/**
 * MusicBrainz API client.
 *
 * Used for artist aliases and, only when identity evidence is required,
 * recording resolution. Recording results are persisted so a sync never
 * repeatedly calls MusicBrainz for the same ambiguous song.
 *
 * Features:
 * - artist and recording search with score threshold
 * - locale-aware alias extraction (prefers en, filters noise)
 * - circuit breaker (survives MB outages)
 * - per-request timeouts
 */

import { getDb } from '../db'
import { titleIdentityDescriptorsCompatible } from '../sync/matchers'
import {
  configureMusicBrainzTransport,
  fetchMusicBrainzJson,
  getMusicBrainzBreakerState,
  musicBrainzTransportAvailable,
} from './musicbrainz-transport'
import { configureMusicBrainzArtist, resolveArtist } from './musicbrainz-artist'
import type {
  MusicBrainzRecordingAmbiguityReason,
  MusicBrainzDurationEvidence,
  MusicBrainzDurationResolutionOutcome,
  MusicBrainzIdMappingResult,
  MusicBrainzRecordingArtistInput,
  MusicBrainzRecordingCandidate,
  MusicBrainzRecordingQueryStrategy,
  MusicBrainzRecordingResolutionOptions,
  MusicBrainzRecordingResult,
  MusicBrainzRecordingStatus,
} from './musicbrainz-types'

export type * from './musicbrainz-types'
export { resolveArtist }

interface MbSearchRecording {
  id: string
  title: string
  score: number
  length?: number | null
  'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>
}

// ── Config ──

const MB_BASE = 'https://musicbrainz.org/ws/2'
let minScore = 90
let minRunnerUpGap = 5

export function configureMusicBrainz(opts: {
  minScore?: number
  requestTimeoutMs?: number
  minRunnerUpGap?: number
  requestIntervalMs?: number
}): void {
  if (opts.minScore !== undefined) minScore = opts.minScore
  if (opts.minRunnerUpGap !== undefined) minRunnerUpGap = Math.max(0, opts.minRunnerUpGap)
  configureMusicBrainzArtist(opts)
  configureMusicBrainzTransport(opts)
}

export const getBreakerState = getMusicBrainzBreakerState

type RecordingCacheStatus = MusicBrainzRecordingStatus | 'disabled'

interface RecordingCacheRow {
  resolved_json: string
  last_status: string
  updated_at: string
}

interface RecordingSearchSuccess {
  ok: true
  candidates: MusicBrainzRecordingCandidate[]
}

interface RecordingSearchFailure {
  ok: false
  reason: string
}

const MAX_RECORDING_CANDIDATES = 5
const DEFAULT_RECORDING_DURATION_TOLERANCE_MS = 2000
const DEFAULT_RECORDING_DURATION_SEPARATION_MS = 500
const MUSICBRAINZ_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GENERIC_ARTIST_NAMES = new Set([
  'various artists',
  'various artist',
  'v.a.',
  'va',
  'unknown artist',
  '[unknown artist]',
  '<unknown artist>',
  '未知艺术家',
  '群星',
])
const GENERIC_ALBUM_NAMES = new Set([
  'unknown album',
  '[unknown album]',
  '<unknown album>',
  '未知专辑',
])

function normalizeRecordingKeyPart(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

function normalizeRecordingArtists(input: MusicBrainzRecordingArtistInput): string[] {
  const values = typeof input === 'string' ? [input] : input
  const seen = new Set<string>()
  const artists: string[] = []
  for (const raw of values) {
    const value = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
    const key = normalizeRecordingKeyPart(value)
    if (!value || GENERIC_ARTIST_NAMES.has(key) || seen.has(key)) continue
    seen.add(key)
    artists.push(value)
  }
  return artists
}

function usableRecordingAlbum(input: string): string | null {
  const value = input.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!value || GENERIC_ALBUM_NAMES.has(normalizeRecordingKeyPart(value))) return null
  return value
}

interface NormalizedRecordingResolutionOptions {
  durationMs: number | null
  durationToleranceMs: number
  minDurationSeparationMs: number
}

function normalizeRecordingResolutionOptions(
  options: MusicBrainzRecordingResolutionOptions | undefined,
): NormalizedRecordingResolutionOptions {
  const rawDuration = Number(options?.durationMs)
  const durationMs = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : null
  const rawTolerance = Number(options?.durationToleranceMs)
  const durationToleranceMs = Number.isFinite(rawTolerance) && rawTolerance >= 0
    ? Math.round(rawTolerance)
    : DEFAULT_RECORDING_DURATION_TOLERANCE_MS
  const rawSeparation = Number(options?.minDurationSeparationMs)
  const minDurationSeparationMs = Number.isFinite(rawSeparation) && rawSeparation >= 0
    ? Math.round(rawSeparation)
    : DEFAULT_RECORDING_DURATION_SEPARATION_MS
  return { durationMs, durationToleranceMs, minDurationSeparationMs }
}

function recordingKey(
  title: string,
  artist: readonly string[],
  album: string | null,
  options: NormalizedRecordingResolutionOptions,
): string {
  const artists = [...artist]
    .map(normalizeRecordingKeyPart)
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort()
    .join('\u001e')
  const identity = [title, artists, album ?? ''].map(normalizeRecordingKeyPart).join('\u001f')
  if (options.durationMs === null) return identity
  // Classification is duration-policy dependent. Keeping it in the key both
  // prevents cross-version cache pollution and bypasses pre-duration caches.
  return [
    identity,
    `duration=${options.durationMs}`,
    `tolerance=${options.durationToleranceMs}`,
    `separation=${options.minDurationSeparationMs}`,
  ].join('\u001f')
}

function recordingTitleVariants(title: string): string[] {
  const original = title.normalize('NFC').replace(/\s+/g, ' ').trim()
  const withoutBracketedCredit = original
    .replace(/\s*[（(【[]\s*(?:feat(?:uring)?|ft|with)\.?\s+[^）)】\]]+[）)】\]]\s*/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const withoutTrailingCredit = withoutBracketedCredit
    .replace(/\s+(?:feat(?:uring)?|ft|with)\.?\s+.+$/iu, '')
    .trim()
  return [...new Set([original, withoutTrailingCredit].filter(Boolean))]
}

function recordingCacheTTL(status: RecordingCacheStatus): number {
  if (status === 'success') return 30 * 24 * 3600 * 1000
  if (status === 'ambiguous' || status === 'empty') return 24 * 3600 * 1000
  if (status === 'failed') return 15 * 60 * 1000
  return 60 * 60 * 1000
}

function isRecordingStatus(value: unknown): value is MusicBrainzRecordingStatus {
  return value === 'success' || value === 'ambiguous' || value === 'empty' || value === 'failed'
}

function isQueryStrategy(value: unknown): value is MusicBrainzRecordingQueryStrategy {
  return value === 'title_artist_release' || value === 'title_release'
    || value === 'title_artist' || value === 'title_only'
}

function normalizeCachedCandidate(value: unknown): MusicBrainzRecordingCandidate | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<MusicBrainzRecordingCandidate>
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') return null
  if (typeof candidate.score !== 'number' || !Number.isFinite(candidate.score)) return null
  return {
    id: candidate.id,
    title: candidate.title,
    score: candidate.score,
    artist: typeof candidate.artist === 'string' ? candidate.artist : null,
    lengthMs: typeof candidate.lengthMs === 'number' && Number.isFinite(candidate.lengthMs) && candidate.lengthMs > 0
      ? Math.round(candidate.lengthMs)
      : null,
  }
}

function getCachedRecording(
  key: string,
  fallbackStrategy: MusicBrainzRecordingQueryStrategy,
  targetTitle: string,
  options: NormalizedRecordingResolutionOptions,
): MusicBrainzRecordingResult | undefined {
  try {
    const row = getDb().prepare('SELECT resolved_json, last_status, updated_at FROM musicbrainz_recording_cache WHERE lookup_key = ?')
      .get(key) as RecordingCacheRow | undefined
    if (!row) return undefined

    const parsed = JSON.parse(row.resolved_json) as Partial<MusicBrainzRecordingResult>
    const inferredStatus: MusicBrainzRecordingStatus = isRecordingStatus(parsed.status)
      ? parsed.status
      : row.last_status === 'failed'
        ? 'failed'
        : parsed.id
          ? 'success'
          : 'empty'
    const updatedAt = new Date(row.updated_at).getTime()
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > recordingCacheTTL(inferredStatus)) return undefined

    const cachedCandidates = Array.isArray(parsed.candidates)
      ? parsed.candidates.map(normalizeCachedCandidate).filter((candidate): candidate is MusicBrainzRecordingCandidate => candidate !== null)
      : []
    if (cachedCandidates.length === 0 && parsed.id && typeof parsed.title === 'string' && typeof parsed.score === 'number') {
      cachedCandidates.push({
        id: parsed.id,
        title: parsed.title,
        score: parsed.score,
        artist: typeof parsed.artist === 'string' ? parsed.artist : null,
        lengthMs: null,
      })
    }

    const queryStrategy = isQueryStrategy(parsed.queryStrategy) ? parsed.queryStrategy : fallbackStrategy
    const attemptedStrategies = Array.isArray(parsed.attemptedStrategies)
      ? parsed.attemptedStrategies.filter(isQueryStrategy)
      : [queryStrategy]

    // Decisions are policy-dependent. Reclassify cached candidates when the
    // configured threshold changes instead of preserving an obsolete ID.
    if (cachedCandidates.length > 0 && inferredStatus !== 'failed') {
      const classified = classifyRecordingCandidates(
        cachedCandidates,
        queryStrategy,
        attemptedStrategies,
        true,
        targetTitle,
        options,
      )
      classified.queryTitle = typeof parsed.queryTitle === 'string' ? parsed.queryTitle : undefined
      classified.attemptedTitles = Array.isArray(parsed.attemptedTitles)
        ? parsed.attemptedTitles.filter((title): title is string => typeof title === 'string')
        : undefined
      return classified
    }

    return {
      id: null,
      score: typeof parsed.score === 'number' ? parsed.score : null,
      title: typeof parsed.title === 'string' ? parsed.title : null,
      artist: typeof parsed.artist === 'string' ? parsed.artist : null,
      status: inferredStatus,
      candidates: [],
      runnerUpGap: typeof parsed.runnerUpGap === 'number' ? parsed.runnerUpGap : null,
      queryStrategy,
      attemptedStrategies,
      ambiguityReason: parsed.ambiguityReason === 'insufficient_constraints'
        || parsed.ambiguityReason === 'below_threshold'
        || parsed.ambiguityReason === 'runner_up_too_close'
        || parsed.ambiguityReason === 'identity_descriptor_mismatch'
        ? parsed.ambiguityReason
        : null,
      failureReason: typeof parsed.failureReason === 'string' ? parsed.failureReason : null,
      policy: { minScore, minRunnerUpGap },
      cacheHit: true,
      queryTitle: typeof parsed.queryTitle === 'string' ? parsed.queryTitle : undefined,
      attemptedTitles: Array.isArray(parsed.attemptedTitles)
        ? parsed.attemptedTitles.filter((title): title is string => typeof title === 'string')
        : undefined,
    }
  } catch {
    return undefined
  }
}

function putCachedRecording(key: string, result: MusicBrainzRecordingResult): void {
  try {
    const now = new Date().toISOString()
    const statement = getDb().prepare(`
      INSERT INTO musicbrainz_recording_cache (lookup_key, resolved_json, last_status, score, failure_count, last_attempt_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(lookup_key) DO UPDATE SET
        resolved_json = excluded.resolved_json,
        last_status = excluded.last_status,
        score = excluded.score,
        failure_count = CASE
          WHEN excluded.last_status = 'failed' THEN musicbrainz_recording_cache.failure_count + 1
          ELSE 0
        END,
        last_attempt_at = excluded.last_attempt_at,
        updated_at = excluded.updated_at
    `)
    const persist = (status: RecordingCacheStatus) => statement.run(
      key,
      JSON.stringify(result),
      status,
      result.score,
      status === 'failed' ? 1 : 0,
      now,
      now,
    )

    try {
      persist(result.status)
    } catch {
      // v34 databases have a CHECK constraint predating `ambiguous`. Keep the
      // true logical status in resolved_json and use empty only as the legacy
      // storage value. New schemas can store ambiguous directly.
      if (result.status === 'ambiguous') persist('empty')
    }
  } catch {
    // SQLite cache is an optimisation, never a sync dependency.
  }
}

function getCachedIdMapping(inputId: string): MusicBrainzIdMappingResult | null {
  try {
    const row = getDb().prepare(`
      SELECT resolved_json, status, updated_at
      FROM musicbrainz_id_mapping_cache
      WHERE input_mbid = ?
    `).get(inputId) as { resolved_json: string; status: MusicBrainzRecordingStatus; updated_at: string } | undefined
    if (!row) return null
    const updatedAt = new Date(row.updated_at).getTime()
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > recordingCacheTTL(row.status)) return null
    const parsed = JSON.parse(row.resolved_json) as MusicBrainzIdMappingResult
    return { ...parsed, cacheHit: true }
  } catch {
    return null
  }
}

function putCachedIdMapping(result: MusicBrainzIdMappingResult): void {
  try {
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO musicbrainz_id_mapping_cache (
        input_mbid, resolved_json, entity_type, status, recording_id,
        failure_count, last_attempt_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(input_mbid) DO UPDATE SET
        resolved_json = excluded.resolved_json,
        entity_type = excluded.entity_type,
        status = excluded.status,
        recording_id = excluded.recording_id,
        failure_count = CASE
          WHEN excluded.status = 'failed' THEN musicbrainz_id_mapping_cache.failure_count + 1
          ELSE 0
        END,
        last_attempt_at = excluded.last_attempt_at,
        updated_at = excluded.updated_at
    `).run(
      result.inputId, JSON.stringify(result), result.entityType, result.status, result.recordingId,
      result.status === 'failed' ? 1 : 0, now, now,
    )
  } catch {
    // This cache improves latency and auditability; its failure cannot make an
    // otherwise safe sync fail or weaken deletion protection.
  }
}

function idMappingResult(
  inputId: string,
  partial: Omit<MusicBrainzIdMappingResult, 'inputId' | 'cacheHit'>,
): MusicBrainzIdMappingResult {
  return { inputId, ...partial, cacheHit: false }
}

const inFlightIdMappings = new Map<string, Promise<MusicBrainzIdMappingResult>>()

async function resolveUncachedMusicBrainzId(inputId: string): Promise<MusicBrainzIdMappingResult> {
  if (!MUSICBRAINZ_UUID_PATTERN.test(inputId)) {
    return idMappingResult(inputId, {
      recordingId: null, entityType: 'unknown', status: 'empty', candidateRecordingIds: [], failureReason: 'invalid_mbid',
    })
  }
  if (!musicBrainzTransportAvailable()) {
    return idMappingResult(inputId, {
      recordingId: null, entityType: 'unknown', status: 'failed', candidateRecordingIds: [], failureReason: 'circuit_open',
    })
  }

  const direct = await fetchMusicBrainzJson(`${MB_BASE}/recording/${inputId}?fmt=json`)
  if (direct.ok) {
    const body = direct.body && typeof direct.body === 'object'
      ? direct.body as { id?: unknown }
      : {}
    const recordingId = typeof body.id === 'string' && MUSICBRAINZ_UUID_PATTERN.test(body.id)
      ? body.id.toLowerCase()
      : inputId
    return idMappingResult(inputId, {
      recordingId, entityType: 'recording', status: 'success', candidateRecordingIds: [recordingId], failureReason: null,
    })
  }
  if (direct.status !== 404) {
    return idMappingResult(inputId, {
      recordingId: null, entityType: 'unknown', status: 'failed', candidateRecordingIds: [], failureReason: direct.reason,
    })
  }

  const search = await fetchMusicBrainzJson(
    `${MB_BASE}/recording/?query=${encodeURIComponent(`tid:${inputId}`)}&fmt=json&limit=${MAX_RECORDING_CANDIDATES}`,
  )
  if (!search.ok) {
    return idMappingResult(inputId, {
      recordingId: null, entityType: 'unknown', status: 'failed', candidateRecordingIds: [], failureReason: search.reason,
    })
  }
  const payload = search.body && typeof search.body === 'object'
    ? search.body as { recordings?: Array<{ id?: unknown }> }
    : {}
  const candidateRecordingIds = [...new Set((payload.recordings ?? [])
    .map(recording => typeof recording.id === 'string' ? recording.id.toLowerCase() : '')
    .filter(id => MUSICBRAINZ_UUID_PATTERN.test(id)))]
  if (candidateRecordingIds.length === 1) {
    return idMappingResult(inputId, {
      recordingId: candidateRecordingIds[0]!, entityType: 'release_track', status: 'success', candidateRecordingIds, failureReason: null,
    })
  }
  return idMappingResult(inputId, {
    recordingId: null,
    entityType: candidateRecordingIds.length > 0 ? 'release_track' : 'unknown',
    status: candidateRecordingIds.length > 1 ? 'ambiguous' : 'empty',
    candidateRecordingIds,
    failureReason: null,
  })
}

/** Resolve a generic Plex mbid:// UUID without guessing its MusicBrainz entity type. */
export async function resolveMusicBrainzIdToRecording(rawId: string): Promise<MusicBrainzIdMappingResult> {
  const inputId = rawId.trim().toLowerCase()
  const cached = getCachedIdMapping(inputId)
  if (cached) return cached
  const existing = inFlightIdMappings.get(inputId)
  if (existing) return existing
  const request = resolveUncachedMusicBrainzId(inputId)
    .then((result) => {
      putCachedIdMapping(result)
      return result
    })
    .finally(() => inFlightIdMappings.delete(inputId))
  inFlightIdMappings.set(inputId, request)
  return request
}

function lucenePhrase(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function recordingQueryStrategy(
  artists: readonly string[],
  album: string | null,
): MusicBrainzRecordingQueryStrategy {
  if (album) return artists.length > 0 ? 'title_artist_release' : 'title_release'
  return artists.length > 0 ? 'title_artist' : 'title_only'
}

function buildRecordingQuery(title: string, artists: readonly string[], album: string | null): string {
  const clauses = [`recording:${lucenePhrase(title)}`]
  if (artists.length === 1) {
    clauses.push(`artist:${lucenePhrase(artists[0]!)}`)
  } else if (artists.length > 1) {
    clauses.push(`(${artists.map(artist => `artist:${lucenePhrase(artist)}`).join(' OR ')})`)
  }
  if (album) clauses.push(`release:${lucenePhrase(album)}`)
  return clauses.join(' AND ')
}

function toRecordingCandidates(recordings: readonly MbSearchRecording[]): MusicBrainzRecordingCandidate[] {
  const candidates = new Map<string, MusicBrainzRecordingCandidate>()
  for (const recording of recordings) {
    const score = Number(recording.score)
    if (!recording.id || !recording.title || !Number.isFinite(score)) continue
    const artist = recording['artist-credit']
      ?.map(item => item.artist?.name ?? item.name ?? '')
      .filter(Boolean)
      .join(', ') || null
    const length = Number(recording.length)
    const candidate: MusicBrainzRecordingCandidate = {
      id: recording.id,
      title: recording.title,
      score,
      artist,
      lengthMs: Number.isFinite(length) && length > 0 ? Math.round(length) : null,
    }
    const existing = candidates.get(recording.id)
    if (!existing || candidate.score > existing.score) candidates.set(recording.id, candidate)
  }
  return [...candidates.values()]
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, MAX_RECORDING_CANDIDATES)
}

async function searchRecordings(query: string): Promise<RecordingSearchSuccess | RecordingSearchFailure> {
  const url = `${MB_BASE}/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=${MAX_RECORDING_CANDIDATES}`
  const response = await fetchMusicBrainzJson(url)
  if (!response.ok) return { ok: false, reason: response.reason }
  const payload = response.body && typeof response.body === 'object'
    ? response.body as { recordings?: MbSearchRecording[] }
    : {}
  return {
    ok: true,
    candidates: toRecordingCandidates(Array.isArray(payload.recordings) ? payload.recordings : []),
  }
}

function classifyRecordingCandidates(
  candidates: MusicBrainzRecordingCandidate[],
  queryStrategy: MusicBrainzRecordingQueryStrategy,
  attemptedStrategies: MusicBrainzRecordingQueryStrategy[],
  cacheHit: boolean,
  targetTitle: string,
  options: NormalizedRecordingResolutionOptions,
): MusicBrainzRecordingResult {
  const decoratedCandidates = candidates.map(candidate => ({
    ...candidate,
    durationDeltaMs: options.durationMs !== null && candidate.lengthMs !== null
      ? Math.abs(candidate.lengthMs - options.durationMs)
      : null,
    titleDescriptorCompatible: titleIdentityDescriptorsCompatible(targetTitle, candidate.title),
  }))
  const eligibleCandidates = decoratedCandidates.filter(candidate => candidate.titleDescriptorCompatible)
  const top = eligibleCandidates[0] ?? null
  const runnerUp = eligibleCandidates[1] ?? null
  const runnerUpGap = top && runnerUp ? top.score - runnerUp.score : null
  const descriptorMismatch = top === null && decoratedCandidates.length > 0
  const insufficientConstraints = top !== null && queryStrategy === 'title_only'
  const belowThreshold = top !== null && top.score < minScore
  const runnerUpTooClose = top !== null && runnerUpGap !== null
    && (runnerUpGap === 0 || runnerUpGap < minRunnerUpGap)
  let durationEvidence: MusicBrainzDurationEvidence | undefined
  let durationSelected: MusicBrainzRecordingCandidate | null = null

  if (runnerUpTooClose && top && options.durationMs !== null) {
    const scoreCompetitors = eligibleCandidates.filter(candidate =>
      top.score - candidate.score === 0 || top.score - candidate.score < minRunnerUpGap,
    )
    const completeDurations = scoreCompetitors.every(candidate => candidate.durationDeltaMs !== null)
    const byDuration = completeDurations
      ? [...scoreCompetitors].sort((left, right) =>
          left.durationDeltaMs! - right.durationDeltaMs!
          || right.score - left.score
          || left.id.localeCompare(right.id),
        )
      : []
    const closest = byDuration[0] ?? null
    const durationRunnerUp = byDuration[1] ?? null
    const closestDeltaMs = closest?.durationDeltaMs ?? null
    const runnerUpDeltaMs = durationRunnerUp?.durationDeltaMs ?? null
    const separationMs = closestDeltaMs !== null && runnerUpDeltaMs !== null
      ? runnerUpDeltaMs - closestDeltaMs
      : null
    let outcome: MusicBrainzDurationResolutionOutcome = 'missing_candidate_durations'

    if (completeDurations && closestDeltaMs !== null && closestDeltaMs > options.durationToleranceMs) {
      outcome = 'outside_tolerance'
    } else if (completeDurations && closestDeltaMs !== null && runnerUpDeltaMs === closestDeltaMs) {
      outcome = 'duration_tie'
    } else if (completeDurations && separationMs !== null && separationMs < options.minDurationSeparationMs) {
      outcome = 'runner_up_too_close'
    } else if (completeDurations && closest && closestDeltaMs !== null
      && closestDeltaMs <= options.durationToleranceMs) {
      outcome = 'selected'
      durationSelected = closest
    }

    durationEvidence = {
      targetMs: options.durationMs,
      toleranceMs: options.durationToleranceMs,
      minSeparationMs: options.minDurationSeparationMs,
      selectedCandidateId: durationSelected?.id ?? null,
      closestDeltaMs,
      runnerUpDeltaMs,
      separationMs,
      outcome,
    }
  }

  let status: MusicBrainzRecordingStatus = 'success'
  let ambiguityReason: MusicBrainzRecordingAmbiguityReason | null = null
  if (descriptorMismatch) {
    status = 'ambiguous'
    ambiguityReason = 'identity_descriptor_mismatch'
  } else if (!top) {
    status = 'empty'
  } else if (insufficientConstraints) {
    status = 'ambiguous'
    ambiguityReason = 'insufficient_constraints'
  } else if (belowThreshold) {
    status = 'ambiguous'
    ambiguityReason = 'below_threshold'
  } else if (runnerUpTooClose && !durationSelected) {
    status = 'ambiguous'
    ambiguityReason = 'runner_up_too_close'
  }

  const selected = durationSelected ?? top

  return {
    id: status === 'success' && selected ? selected.id : null,
    score: selected?.score ?? null,
    title: selected?.title ?? null,
    artist: selected?.artist ?? null,
    status,
    candidates: decoratedCandidates,
    runnerUpGap,
    queryStrategy,
    attemptedStrategies,
    ambiguityReason,
    failureReason: null,
    policy: { minScore, minRunnerUpGap },
    cacheHit,
    durationEvidence,
  }
}

function failedRecordingResult(
  queryStrategy: MusicBrainzRecordingQueryStrategy,
  attemptedStrategies: MusicBrainzRecordingQueryStrategy[],
  reason: string,
): MusicBrainzRecordingResult {
  return {
    id: null,
    score: null,
    title: null,
    artist: null,
    status: 'failed',
    candidates: [],
    runnerUpGap: null,
    queryStrategy,
    attemptedStrategies,
    ambiguityReason: null,
    failureReason: reason,
    policy: { minScore, minRunnerUpGap },
    cacheHit: false,
  }
}

/**
 * Resolve an MB recording only for an already-discovered ambiguity. Artist
 * aliases are queried together. Release is a strict first pass; an empty
 * strict result falls back to title + artist. Any uncertainty returns a null
 * ID plus persisted evidence, so callers can never auto-bind it.
 */
async function resolveRecordingInternal(
  title: string,
  artist: MusicBrainzRecordingArtistInput,
  album = '',
  resolutionOptions?: MusicBrainzRecordingResolutionOptions,
): Promise<MusicBrainzRecordingResult | null> {
  const artists = normalizeRecordingArtists(artist)
  const usableAlbum = usableRecordingAlbum(album)
  const titleVariants = recordingTitleVariants(title)
  const options = normalizeRecordingResolutionOptions(resolutionOptions)
  const key = recordingKey(titleVariants.join('\u001d'), artists, usableAlbum, options)
  const initialStrategy = recordingQueryStrategy(artists, usableAlbum)
  const cached = getCachedRecording(key, initialStrategy, titleVariants[0] ?? title, options)
  if (cached) return cached

  if (!musicBrainzTransportAvailable()) {
    const result = failedRecordingResult(initialStrategy, [], 'circuit_open')
    putCachedRecording(key, result)
    return result
  }

  const attemptedStrategies: MusicBrainzRecordingQueryStrategy[] = []
  const attemptedTitles: string[] = []
  let queryTitle = titleVariants[0] ?? title
  let strategy = initialStrategy
  let search = await searchRecordings(buildRecordingQuery(queryTitle, artists, usableAlbum))
  attemptedStrategies.push(strategy)
  attemptedTitles.push(queryTitle)
  if (!search.ok) {
    const result = failedRecordingResult(strategy, attemptedStrategies, search.reason)
    putCachedRecording(key, result)
    return result
  }

  // A release name is useful precision but Plex/MB release metadata often
  // differs. Only a genuinely empty strict result is eligible for fallback;
  // low-score or competing strict candidates remain review-only evidence.
  if (usableAlbum && search.candidates.length === 0) {
    strategy = recordingQueryStrategy(artists, null)
    search = await searchRecordings(buildRecordingQuery(queryTitle, artists, null))
    attemptedStrategies.push(strategy)
    if (!search.ok) {
      const result = failedRecordingResult(strategy, attemptedStrategies, search.reason)
      putCachedRecording(key, result)
      return result
    }
  }

  // Collaboration credits are represented inconsistently across providers:
  // Netease commonly keeps "(feat. X)" in the title while MusicBrainz stores
  // the same names in artist-credit. Only a fully empty original-title search
  // may fall back; ambiguous or low-score results remain review-only.
  if (search.candidates.length === 0 && titleVariants.length > 1) {
    queryTitle = titleVariants[1]!
    strategy = recordingQueryStrategy(artists, usableAlbum)
    search = await searchRecordings(buildRecordingQuery(queryTitle, artists, usableAlbum))
    attemptedStrategies.push(strategy)
    attemptedTitles.push(queryTitle)
    if (!search.ok) {
      const result = failedRecordingResult(strategy, attemptedStrategies, search.reason)
      result.queryTitle = queryTitle
      result.attemptedTitles = attemptedTitles
      putCachedRecording(key, result)
      return result
    }
    if (usableAlbum && search.candidates.length === 0) {
      strategy = recordingQueryStrategy(artists, null)
      search = await searchRecordings(buildRecordingQuery(queryTitle, artists, null))
      attemptedStrategies.push(strategy)
      if (!search.ok) {
        const result = failedRecordingResult(strategy, attemptedStrategies, search.reason)
        result.queryTitle = queryTitle
        result.attemptedTitles = attemptedTitles
        putCachedRecording(key, result)
        return result
      }
    }
  }

  const result = classifyRecordingCandidates(
    search.candidates,
    strategy,
    attemptedStrategies,
    false,
    queryTitle,
    options,
  )
  result.queryTitle = queryTitle
  result.attemptedTitles = attemptedTitles
  putCachedRecording(key, result)
  return result
}

const inFlightRecordingResolutions = new Map<string, Promise<MusicBrainzRecordingResult | null>>()

export function resolveRecording(
  title: string,
  artist: MusicBrainzRecordingArtistInput,
  album = '',
  resolutionOptions?: MusicBrainzRecordingResolutionOptions,
): Promise<MusicBrainzRecordingResult | null> {
  const artists = normalizeRecordingArtists(artist)
  const options = normalizeRecordingResolutionOptions(resolutionOptions)
  const key = recordingKey(
    recordingTitleVariants(title).join('\u001d'),
    artists,
    usableRecordingAlbum(album),
    options,
  )
  const existing = inFlightRecordingResolutions.get(key)
  if (existing) return existing

  const request = resolveRecordingInternal(title, artists, album, resolutionOptions)
    .finally(() => inFlightRecordingResolutions.delete(key))
  inFlightRecordingResolutions.set(key, request)
  return request
}
