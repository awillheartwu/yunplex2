import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  BindingMethod,
  BindingStatus,
  MatchReview,
  MatchReviewPage,
  ReviewEvidenceType,
  ReviewStatus,
  SongIdentityBinding,
} from '~~/types/match-review'
import { getDb } from '../db'
import { parseJsonObject } from '../json'
import {
  queryMatchReviewsReadModel,
  type MatchReviewFilters,
} from './match-review-read-store'
import { mapMatchReviewRow, type MatchReviewRow } from './match-review-record'
import {
  buildMatchReviewCandidateKey,
  normalizePlexPath,
  normalizePlexRelativePath,
  resolvePlexIdentityPath,
} from './identity-normalization'
import { recordIdentityTransition } from './identity-transition'
import { appendSongIdentityEvent } from './match-management-store'

export type { BindingMethod, BindingStatus, ReviewEvidenceType, ReviewStatus, SongIdentityBinding, MatchReview, MatchReviewFilters }
export { buildMatchReviewCandidateKey, normalizePlexPath, normalizePlexRelativePath, resolvePlexIdentityPath }

const REVIEW_EVIDENCE_TYPES = new Set<ReviewEvidenceType>([
  'path', 'mb_recording', 'metadata', 'historical', 'manual', 'migration',
])

const REVIEW_EVIDENCE_STRENGTH: Record<ReviewEvidenceType, number> = {
  historical: 0,
  metadata: 1,
  migration: 2,
  mb_recording: 3,
  path: 4,
  manual: 5,
}

type BindingRow = {
  netease_song_id: number
  plex_section_key: string
  plex_file_path: string
  plex_relative_path: string
  plex_rating_key: string | null
  mb_recording_id: string | null
  binding_method: BindingMethod
  status: BindingStatus
  evidence_json: string
  created_at: string
  updated_at: string
  last_verified_at: string | null
}

interface CreateReviewInput {
  neteaseSongId: number
  sourceId?: string | null
  runId?: string | null
  candidatePlexFilePath?: string | null
  candidatePlexRatingKey?: string | null
  candidateMbRecordingId?: string | null
  evidenceType?: ReviewEvidenceType
  evidence?: Record<string, unknown>
  status?: ReviewStatus
  decision?: string | null
}

export interface BindingInput extends Omit<SongIdentityBinding, 'createdAt' | 'updatedAt' | 'lastVerifiedAt' | 'plexRelativePath'> {
  plexRelativePath?: string
  plexSectionRoot?: string | null
  lastVerifiedAt?: string | null
}

function nextVersionTimestamp(previous?: string | null): string {
  const now = Date.now()
  const previousMs = previous ? Date.parse(previous) : Number.NaN
  return new Date(Number.isFinite(previousMs) && previousMs >= now ? previousMs + 1 : now).toISOString()
}

function configuredPlexSectionRoot(): string {
  try {
    const row = getDb().prepare("SELECT value FROM config WHERE key = 'app'").get() as { value: string } | undefined
    if (!row) return ''
    const config = JSON.parse(row.value) as { download?: { plexLibraryPathPrefix?: unknown } }
    return typeof config.download?.plexLibraryPathPrefix === 'string'
      ? normalizePlexPath(config.download.plexLibraryPathPrefix)
      : ''
  } catch {
    return ''
  }
}

function bindingFromRow(row: BindingRow): SongIdentityBinding {
  return {
    neteaseSongId: row.netease_song_id,
    plexSectionKey: row.plex_section_key,
    plexFilePath: row.plex_file_path,
    plexRelativePath: row.plex_relative_path || normalizePlexRelativePath(row.plex_file_path, configuredPlexSectionRoot()),
    plexRatingKey: row.plex_rating_key,
    mbRecordingId: row.mb_recording_id,
    bindingMethod: row.binding_method,
    status: row.status,
    evidence: parseJsonObject(row.evidence_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  }
}

function inferEvidenceType(input: CreateReviewInput): ReviewEvidenceType {
  if (input.evidenceType) return input.evidenceType
  if (input.status === 'unbound' || input.decision?.startsWith('manual_')) return 'manual'
  if (input.decision?.includes('migrat')) return 'migration'
  if (input.candidateMbRecordingId) return 'mb_recording'
  if (input.evidence?.pathExact === true || input.evidence?.source === 'path') return 'path'
  if (input.evidence?.reason || input.candidatePlexFilePath || input.candidatePlexRatingKey) return 'metadata'
  return 'historical'
}

function insertOccurrence(db: Database.Database, reviewId: string, input: Pick<CreateReviewInput, 'sourceId' | 'runId'>, observedAt: string): void {
  if (!input.sourceId && !input.runId) return
  db.prepare(`
    INSERT OR IGNORE INTO song_match_review_occurrences (review_id, source_id, run_id, observed_at)
    VALUES (?, ?, ?, ?)
  `).run(reviewId, input.sourceId ?? '', input.runId ?? '', observedAt)
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === 'pending' || value === 'accepted' || value === 'rejected'
    || value === 'unbound' || value === 'superseded'
}

export function isReviewEvidenceType(value: unknown): value is ReviewEvidenceType {
  return typeof value === 'string' && REVIEW_EVIDENCE_TYPES.has(value as ReviewEvidenceType)
}

export function getSongIdentityBinding(neteaseSongId: number): SongIdentityBinding | null {
  const row = getDb().prepare('SELECT * FROM song_identity_bindings WHERE netease_song_id = ?')
    .get(neteaseSongId) as BindingRow | undefined
  return row ? bindingFromRow(row) : null
}

export function getSongIdentityBindingByRatingKey(ratingKey: string): SongIdentityBinding | null {
  const rows = getDb().prepare(`
    SELECT * FROM song_identity_bindings
    WHERE plex_rating_key = ? AND status = ?
    ORDER BY netease_song_id ASC
    LIMIT 2
  `).all(ratingKey, 'active') as BindingRow[]
  // A shared ratingKey is not proof of which Netease identity owns an extra
  // occurrence. Treat ambiguity as unknown so it can never authorize deletion.
  return rows.length === 1 ? bindingFromRow(rows[0]!) : null
}

export function getReplacedSongIdentityIdsByRatingKeys(ratingKeys: string[]): Map<string, number> {
  const keys = [...new Set(ratingKeys.filter(Boolean))]
  if (keys.length === 0) return new Map()

  const rows = getDb().prepare(`
    SELECT
      e.netease_song_id,
      e.event_type,
      e.previous_binding_json,
      e.next_binding_json,
      e.evidence_json,
      b.plex_rating_key AS current_plex_rating_key
    FROM song_identity_events e
    JOIN song_identity_bindings b ON b.netease_song_id = e.netease_song_id
    WHERE b.status = 'active'
      AND e.previous_binding_json IS NOT NULL
      AND e.next_binding_json IS NOT NULL
      AND json_extract(e.previous_binding_json, '$.plexRatingKey')
        IN (${keys.map(() => '?').join(', ')})
    ORDER BY e.created_at DESC
  `).all(...keys) as Array<{
    netease_song_id: number
    event_type: string
    previous_binding_json: string
    next_binding_json: string
    evidence_json: string
    current_plex_rating_key: string | null
  }>

  const songIdsByOldKey = new Map<string, Set<number>>()
  for (const row of rows) {
    const previous = parseJsonObject(row.previous_binding_json)
    const next = parseJsonObject(row.next_binding_json)
    const evidence = parseJsonObject(row.evidence_json)
    const previousKey = typeof previous.plexRatingKey === 'string' ? previous.plexRatingKey : ''
    const nextKey = typeof next.plexRatingKey === 'string' ? next.plexRatingKey : ''
    const staleReplacedByExactManagedPath = previous.status === 'stale'
      && row.event_type === 'auto_migrate'
      && next.bindingMethod === 'path'
      && evidence.source === 'plex_retry_exact_path'
      && evidence.matchedBy === 'path_lookup'
      && ['download_missing', 'redownload_replaced'].includes(String(evidence.mediaPolicy))
    if (
      !previousKey
      || (previous.status !== 'active' && !staleReplacedByExactManagedPath)
      || next.status !== 'active'
      || !nextKey
      || nextKey === previousKey
      || !row.current_plex_rating_key
      || row.current_plex_rating_key === previousKey
    ) continue

    const songIds = songIdsByOldKey.get(previousKey) ?? new Set<number>()
    songIds.add(row.netease_song_id)
    songIdsByOldKey.set(previousKey, songIds)
  }

  return new Map(
    [...songIdsByOldKey.entries()]
      .filter(([, songIds]) => songIds.size === 1)
      .map(([ratingKey, songIds]) => [ratingKey, [...songIds][0]!] as const),
  )
}

export function getSongIdentityBindings(songIds: number[]): Map<number, SongIdentityBinding> {
  const ids = [...new Set(songIds)].filter(Number.isFinite)
  const result = new Map<number, SongIdentityBinding>()
  if (ids.length === 0) return result
  const rows = getDb().prepare(`
    SELECT * FROM song_identity_bindings
    WHERE netease_song_id IN (${ids.map(() => '?').join(', ')})
  `).all(...ids) as BindingRow[]
  for (const row of rows) result.set(row.netease_song_id, bindingFromRow(row))
  return result
}

export function getActiveSongIdentityBindings(songIds: number[]): Map<number, SongIdentityBinding> {
  const result = getSongIdentityBindings(songIds)
  for (const [songId, binding] of result) {
    if (binding.status !== 'active') result.delete(songId)
  }
  return result
}

export function upsertSongIdentityBinding(input: BindingInput): SongIdentityBinding {
  const existingVersion = (getDb().prepare(`
    SELECT updated_at FROM song_identity_bindings WHERE netease_song_id = ?
  `).get(input.neteaseSongId) as { updated_at: string } | undefined)?.updated_at
  const now = nextVersionTimestamp(existingVersion)
  const plexFilePath = normalizePlexPath(input.plexFilePath)
  const sectionRoot = input.plexSectionRoot === undefined ? configuredPlexSectionRoot() : input.plexSectionRoot
  const plexRelativePath = input.plexRelativePath === undefined
    ? normalizePlexRelativePath(plexFilePath, sectionRoot)
    : normalizePlexRelativePath(input.plexRelativePath)
  const lastVerifiedAt = Object.prototype.hasOwnProperty.call(input, 'lastVerifiedAt')
    ? input.lastVerifiedAt ?? null
    : now

  getDb().prepare(`
    INSERT INTO song_identity_bindings (
      netease_song_id, plex_section_key, plex_file_path, plex_relative_path, plex_rating_key,
      mb_recording_id, binding_method, status, evidence_json, created_at, updated_at, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(netease_song_id) DO UPDATE SET
      plex_section_key = excluded.plex_section_key,
      plex_file_path = excluded.plex_file_path,
      plex_relative_path = excluded.plex_relative_path,
      plex_rating_key = excluded.plex_rating_key,
      mb_recording_id = excluded.mb_recording_id,
      binding_method = excluded.binding_method,
      status = excluded.status,
      evidence_json = excluded.evidence_json,
      updated_at = excluded.updated_at,
      last_verified_at = excluded.last_verified_at
  `).run(
    input.neteaseSongId, input.plexSectionKey, plexFilePath, plexRelativePath,
    input.plexRatingKey, input.mbRecordingId, input.bindingMethod, input.status,
    JSON.stringify(input.evidence), now, now, lastVerifiedAt,
  )
  return getSongIdentityBinding(input.neteaseSongId)!
}

/** Persist a machine-verified identity and retire weaker pending candidates.
 * Manual review uses `upsertSongIdentityBinding` directly so its selected
 * review can first transition to `accepted` inside the decision transaction. */
export function upsertVerifiedSongIdentityBinding(input: BindingInput): SongIdentityBinding {
  const db = getDb()
  return db.transaction(() => {
    const previous = getSongIdentityBinding(input.neteaseSongId)
    let binding = upsertSongIdentityBinding(input)
    const identityChanged = !previous
      || previous.status !== binding.status
      || previous.plexRelativePath !== binding.plexRelativePath
      || previous.mbRecordingId !== binding.mbRecordingId
    // ratingKey is a refreshable Plex cache and verification evidence is
    // observational state. Neither changes which durable file identity the
    // Netease song points to, so preserve the optimistic-lock/alignment
    // version when the canonical path and recording identity are unchanged.
    if (!identityChanged && previous) {
      db.prepare(`
        UPDATE song_identity_bindings
        SET updated_at = ?
        WHERE netease_song_id = ?
      `).run(previous.updatedAt, input.neteaseSongId)
      binding = getSongIdentityBinding(input.neteaseSongId)!
    }
    if (identityChanged) {
      recordIdentityTransition({
        neteaseSongId: binding.neteaseSongId,
        eventType: previous && previous.plexRelativePath !== binding.plexRelativePath ? 'auto_migrate' : 'auto_bind',
        actorType: 'system',
        sourceId: typeof input.evidence.sourceId === 'string' ? input.evidence.sourceId : null,
        runId: typeof input.evidence.runId === 'string' ? input.evidence.runId : null,
        previousBinding: previous,
        nextBinding: binding,
        evidence: input.evidence,
      })
    }
    if (binding.status === 'active') {
      const now = new Date().toISOString()
      db.prepare(`
        UPDATE song_match_reviews
        SET status = 'superseded', decision = ?, decided_at = ?
        WHERE netease_song_id = ? AND status = 'pending'
      `).run(`resolved_by_${binding.bindingMethod}`, now, binding.neteaseSongId)
    }
    return binding
  })()
}

export function markSongIdentityBindingStale(neteaseSongId: number, evidence: Record<string, unknown> = {}): void {
  const db = getDb()
  db.transaction(() => {
    const previous = getSongIdentityBinding(neteaseSongId)
    if (!previous || previous.status === 'stale') return
    const now = nextVersionTimestamp(previous.updatedAt)
    db.prepare(`
      UPDATE song_identity_bindings
      SET status = 'stale', evidence_json = ?, updated_at = ?
      WHERE netease_song_id = ?
    `).run(JSON.stringify({ ...previous.evidence, ...evidence }), now, neteaseSongId)
    const next = getSongIdentityBinding(neteaseSongId)
    recordIdentityTransition({
      neteaseSongId,
      eventType: 'invalidate',
      actorType: 'system',
      previousBinding: previous,
      nextBinding: next,
      evidence,
      createdAt: now,
    })
  })()
}

export function markAutomaticSongIdentityBindingsStale(
  songIds: number[],
  evidence: Record<string, unknown> = {},
): number {
  const ids = [...new Set(songIds)].filter(Number.isFinite)
  if (ids.length === 0) return 0
  const rows = getDb().prepare(`
    SELECT netease_song_id
    FROM song_identity_bindings
    WHERE netease_song_id IN (${ids.map(() => '?').join(', ')})
      AND status = 'active'
      AND binding_method != 'manual'
  `).all(...ids) as Array<{ netease_song_id: number }>

  for (const row of rows) {
    markSongIdentityBindingStale(row.netease_song_id, {
      ...evidence,
      reason: 'manual_rebuild_matching',
    })
  }
  return rows.length
}

export function unbindSongIdentity(neteaseSongId: number, sourceId?: string | null, runId?: string | null): void {
  const db = getDb()
  db.transaction(() => {
    const currentRow = db.prepare('SELECT * FROM song_identity_bindings WHERE netease_song_id = ?')
      .get(neteaseSongId) as BindingRow | undefined
    if (!currentRow) return
    const previousBinding = bindingFromRow(currentRow)
    const now = nextVersionTimestamp(previousBinding.updatedAt)
    db.prepare(`
      UPDATE song_identity_bindings SET status = 'unbound', updated_at = ? WHERE netease_song_id = ?
    `).run(now, neteaseSongId)
    const nextBinding = getSongIdentityBinding(neteaseSongId)
    createMatchReview({
      neteaseSongId,
      sourceId,
      runId,
      status: 'unbound',
      decision: 'manual_unbind',
      evidenceType: 'manual',
      evidence: { previousBinding },
    })
    recordIdentityTransition({
      neteaseSongId,
      eventType: 'manual_reevaluate',
      actorType: 'admin',
      sourceId,
      runId,
      previousBinding,
      nextBinding,
      evidence: { mode: 'reevaluate' },
      createdAt: now,
    })
  })()
}

export function createMatchReview(input: CreateReviewInput): MatchReview {
  const db = getDb()
  const sectionRoot = configuredPlexSectionRoot()
  const candidatePlexFilePath = input.candidatePlexFilePath
    ? normalizePlexPath(input.candidatePlexFilePath)
    : null
  const candidateKey = buildMatchReviewCandidateKey({
    neteaseSongId: input.neteaseSongId,
    candidatePlexFilePath,
    candidatePlexRatingKey: input.candidatePlexRatingKey,
    candidateMbRecordingId: input.candidateMbRecordingId,
    plexSectionRoot: sectionRoot,
  })
  const status = input.status ?? 'pending'
  const evidenceType = inferEvidenceType(input)

  const id = db.transaction(() => {
    if (status === 'pending' && (candidatePlexFilePath || input.candidatePlexRatingKey)) {
      const rejected = db.prepare(`
        SELECT * FROM song_match_reviews
        WHERE netease_song_id = ? AND status = 'rejected'
          AND COALESCE(candidate_plex_file_path, '') = ?
          AND COALESCE(candidate_plex_rating_key, '') = ?
        ORDER BY decided_at DESC, created_at DESC
        LIMIT 1
      `).get(
        input.neteaseSongId,
        candidatePlexFilePath ?? '',
        input.candidatePlexRatingKey?.trim() ?? '',
      ) as MatchReviewRow | undefined
      if (rejected) {
        insertOccurrence(db, rejected.id, input, new Date().toISOString())
        return rejected.id
      }
    }
    if (status === 'pending' && candidateKey) {
      const existing = db.prepare(`
        SELECT * FROM song_match_reviews
        WHERE candidate_key = ? AND status IN ('pending', 'rejected')
        ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1
      `).get(candidateKey) as MatchReviewRow | undefined
      if (existing) {
        if (
          existing.status === 'pending'
          && REVIEW_EVIDENCE_STRENGTH[evidenceType] >= REVIEW_EVIDENCE_STRENGTH[existing.evidence_type]
        ) {
          // Enrich the existing occurrence instead of producing a second card
          // when a later pass obtains MB/path evidence for the same Plex item.
          db.prepare(`
            UPDATE song_match_reviews
            SET candidate_plex_file_path = COALESCE(?, candidate_plex_file_path),
                candidate_plex_rating_key = COALESCE(?, candidate_plex_rating_key),
                candidate_mb_recording_id = COALESCE(?, candidate_mb_recording_id),
                evidence_type = ?, evidence_json = ?
            WHERE id = ?
          `).run(
            candidatePlexFilePath,
            input.candidatePlexRatingKey?.trim() || null,
            input.candidateMbRecordingId?.trim().toLowerCase() || null,
            evidenceType,
            JSON.stringify(input.evidence ?? {}),
            existing.id,
          )
        }
        insertOccurrence(db, existing.id, input, new Date().toISOString())
        return existing.id
      }
    }

    const createdAt = new Date().toISOString()
    const reviewId = randomUUID()
    db.prepare(`
      INSERT INTO song_match_reviews (
        id, netease_song_id, source_id, run_id, candidate_plex_file_path,
        candidate_plex_rating_key, candidate_mb_recording_id, candidate_key,
        evidence_type, evidence_json, status, decision, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reviewId, input.neteaseSongId, input.sourceId ?? null, input.runId ?? null,
      candidatePlexFilePath, input.candidatePlexRatingKey?.trim() || null,
      input.candidateMbRecordingId?.trim().toLowerCase() || null, candidateKey,
      evidenceType, JSON.stringify(input.evidence ?? {}), status, input.decision ?? null,
      createdAt, status === 'pending' ? null : createdAt,
    )
    insertOccurrence(db, reviewId, input, createdAt)
    return reviewId
  })()

  return getMatchReview(id)!
}

export function getMatchReview(id: string): MatchReview | null {
  const row = getDb().prepare('SELECT * FROM song_match_reviews WHERE id = ?').get(id) as MatchReviewRow | undefined
  return row ? mapMatchReviewRow(row) : null
}

/**
 * Human rejection outranks later weak enrichment of the same Plex occurrence.
 * MB evidence is intentionally not part of this lookup: discovering an MBID
 * later must not resurrect a path/ratingKey the user already rejected.
 */
export function findRejectedMatchReview(input: {
  neteaseSongId: number
  candidatePlexFilePath?: string | null
  candidatePlexRatingKey?: string | null
}): MatchReview | null {
  const path = input.candidatePlexFilePath ? normalizePlexPath(input.candidatePlexFilePath) : ''
  const ratingKey = input.candidatePlexRatingKey?.trim() ?? ''
  if (!path && !ratingKey) return null
  const row = getDb().prepare(`
    SELECT * FROM song_match_reviews
    WHERE netease_song_id = ? AND status = 'rejected'
      AND COALESCE(candidate_plex_file_path, '') = ?
      AND COALESCE(candidate_plex_rating_key, '') = ?
    ORDER BY decided_at DESC, created_at DESC
    LIMIT 1
  `).get(input.neteaseSongId, path, ratingKey) as MatchReviewRow | undefined
  return row ? mapMatchReviewRow(row) : null
}

export function queryMatchReviews(filters: MatchReviewFilters = {}): MatchReviewPage {
  return queryMatchReviewsReadModel(filters, getSongIdentityBindings)
}

export { listMatchReviews } from './match-review-read-store'

export interface MatchReviewDecisionBinding {
  plexSectionKey: string
  plexFilePath: string
  plexRelativePath?: string
  plexSectionRoot?: string | null
  plexRatingKey?: string | null
  mbRecordingId?: string | null
  evidence?: Record<string, unknown>
}

export interface MatchReviewDecisionInput {
  id: string
  decision: 'accept' | 'reject'
  binding?: MatchReviewDecisionBinding
}

function applyMatchReviewDecision(db: Database.Database, input: MatchReviewDecisionInput): MatchReview {
  const { id, decision, binding } = input
  const row = db.prepare('SELECT * FROM song_match_reviews WHERE id = ?').get(id) as MatchReviewRow | undefined
  if (!row) throw new Error(`审核记录不存在：${id}`)
  if (row.status !== 'pending') {
    const sameDecision = (decision === 'accept' && row.status === 'accepted')
      || (decision === 'reject' && row.status === 'rejected')
    if (sameDecision) return mapMatchReviewRow(row)
    throw new Error(`审核记录已是“${row.status}”状态，不能再次决策`)
  }

  const review = mapMatchReviewRow(row)
  const now = new Date().toISOString()
  if (decision === 'accept') {
    if (!binding) throw new Error('接受匹配需要 Plex 文件身份')
    const hasExplicitRecordingId = Object.prototype.hasOwnProperty.call(binding, 'mbRecordingId')
    const previousBinding = getSongIdentityBinding(review.neteaseSongId)
    const nextBinding = upsertSongIdentityBinding({
      neteaseSongId: review.neteaseSongId,
      plexSectionKey: binding.plexSectionKey,
      plexFilePath: binding.plexFilePath,
      plexRelativePath: binding.plexRelativePath,
      plexSectionRoot: binding.plexSectionRoot,
      plexRatingKey: binding.plexRatingKey ?? review.candidatePlexRatingKey,
      mbRecordingId: hasExplicitRecordingId ? binding.mbRecordingId ?? null : review.candidateMbRecordingId,
      bindingMethod: 'manual',
      status: 'active',
      evidence: { ...binding.evidence, reviewId: id, decision: 'manual_accept' },
    })
    db.prepare(`
      UPDATE song_match_reviews
      SET status = 'accepted', decision = 'manual_accept', evidence_type = 'manual', decided_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(now, id)
    db.prepare(`
      UPDATE song_match_reviews
      SET status = 'superseded', decision = 'accepted_elsewhere', decided_at = ?
      WHERE netease_song_id = ? AND status = 'pending' AND id != ?
    `).run(now, review.neteaseSongId, id)
    recordIdentityTransition({
      neteaseSongId: review.neteaseSongId,
      eventType: 'manual_accept',
      actorType: 'admin',
      sourceId: review.sourceId,
      runId: review.runId,
      reviewId: id,
      previousBinding,
      nextBinding,
      evidence: { ...binding.evidence, candidateKey: row.candidate_key },
      createdAt: now,
    })
  } else {
    db.prepare(`
      UPDATE song_match_reviews
      SET status = 'rejected', decision = 'manual_reject', evidence_type = 'manual', decided_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(now, id)
    appendSongIdentityEvent({
      neteaseSongId: review.neteaseSongId,
      eventType: 'manual_reject',
      actorType: 'admin',
      sourceId: review.sourceId,
      runId: review.runId,
      reviewId: id,
      previousBinding: getSongIdentityBinding(review.neteaseSongId),
      nextBinding: getSongIdentityBinding(review.neteaseSongId),
      evidence: {
        candidateKey: row.candidate_key,
        plexFilePath: review.candidatePlexFilePath,
        plexRatingKey: review.candidatePlexRatingKey,
      },
      createdAt: now,
    })
  }

  const updated = db.prepare('SELECT * FROM song_match_reviews WHERE id = ?').get(id) as MatchReviewRow
  return mapMatchReviewRow(updated)
}

export class BindingVersionConflictError extends Error {
  constructor() {
    super('歌曲绑定已被其他操作更新，请刷新后重新确认')
    this.name = 'BindingVersionConflictError'
  }
}

export function rebindSongIdentity(input: {
  neteaseSongId: number
  expectedBindingUpdatedAt: string | null
  binding: Omit<BindingInput, 'neteaseSongId' | 'bindingMethod' | 'status'>
  sourceId?: string | null
  reviewId?: string | null
}): { binding: SongIdentityBinding; affectedSources: Array<{ id: string; name: string }> } {
  const db = getDb()
  return db.transaction(() => {
    const previous = getSongIdentityBinding(input.neteaseSongId)
    if ((previous?.updatedAt ?? null) !== input.expectedBindingUpdatedAt) {
      throw new BindingVersionConflictError()
    }
    const binding = upsertSongIdentityBinding({
      ...input.binding,
      neteaseSongId: input.neteaseSongId,
      bindingMethod: 'manual',
      status: 'active',
      evidence: { ...input.binding.evidence, decision: 'manual_rebind' },
    })
    const now = binding.updatedAt
    const affectedSources = recordIdentityTransition({
      neteaseSongId: input.neteaseSongId,
      eventType: 'manual_rebind',
      actorType: 'admin',
      sourceId: input.sourceId,
      reviewId: input.reviewId,
      previousBinding: previous,
      nextBinding: binding,
      evidence: input.binding.evidence,
      createdAt: now,
    })
    return { binding, affectedSources }
  })()
}

export function unbindSongIdentityWithMode(input: {
  neteaseSongId: number
  expectedBindingUpdatedAt: string
  mode: 'reevaluate' | 'exclude_current'
  sourceId?: string | null
}): { binding: SongIdentityBinding; affectedSources: Array<{ id: string; name: string }> } {
  const db = getDb()
  return db.transaction(() => {
    const previous = getSongIdentityBinding(input.neteaseSongId)
    if (!previous || previous.updatedAt !== input.expectedBindingUpdatedAt) {
      throw new BindingVersionConflictError()
    }
    const now = nextVersionTimestamp(previous.updatedAt)
    db.prepare(`
      UPDATE song_identity_bindings
      SET status = 'unbound', updated_at = ?
      WHERE netease_song_id = ? AND updated_at = ?
    `).run(now, input.neteaseSongId, input.expectedBindingUpdatedAt)
    const binding = getSongIdentityBinding(input.neteaseSongId)!
    let reviewId: string | null = null
    if (input.mode === 'exclude_current') {
      const review = createMatchReview({
        neteaseSongId: input.neteaseSongId,
        sourceId: input.sourceId,
        candidatePlexFilePath: previous.plexFilePath,
        candidatePlexRatingKey: previous.plexRatingKey,
        candidateMbRecordingId: previous.mbRecordingId,
        evidenceType: 'manual',
        evidence: { previousBinding: previous, reason: '人工排除此文件' },
        status: 'rejected',
        decision: 'manual_exclude',
      })
      reviewId = review.id
    }
    const affectedSources = recordIdentityTransition({
      neteaseSongId: input.neteaseSongId,
      eventType: input.mode === 'exclude_current' ? 'manual_exclude' : 'manual_reevaluate',
      actorType: 'admin',
      sourceId: input.sourceId,
      reviewId,
      previousBinding: previous,
      nextBinding: binding,
      evidence: { mode: input.mode },
      createdAt: now,
    })
    return { binding, affectedSources }
  })()
}

/** Apply a batch as one database transaction: either every decision is
 * persisted, or none are. Plex candidates must be validated before calling. */
export function decideMatchReviewsBatch(inputs: MatchReviewDecisionInput[]): MatchReview[] {
  if (inputs.length === 0) return []
  const ids = inputs.map(input => input.id)
  if (new Set(ids).size !== ids.length) throw new Error('批量审核包含重复记录')
  const db = getDb()
  return db.transaction(() => inputs.map(input => applyMatchReviewDecision(db, input)))()
}

export function decideMatchReview(
  id: string,
  decision: 'accept' | 'reject',
  binding?: MatchReviewDecisionBinding,
): MatchReview | null {
  try {
    return decideMatchReviewsBatch([{ id, decision, binding }])[0] ?? null
  } catch (error) {
    if (error instanceof Error && error.message === `审核记录不存在：${id}`) return null
    throw error
  }
}
