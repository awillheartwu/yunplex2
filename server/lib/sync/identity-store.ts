import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  BindingMethod,
  BindingStatus,
  MatchReview,
  MatchReviewCounts,
  MatchReviewEvidenceFacet,
  MatchReviewPage,
  MatchReviewSourceFacet,
  ReviewEvidenceType,
  ReviewStatus,
  SongIdentityBinding,
} from '~~/types/match-review'
import { getDb } from '../db'
import {
  buildMatchReviewCandidateKey,
  normalizePlexPath,
  normalizePlexRelativePath,
  resolvePlexIdentityPath,
} from './identity-normalization'
import { appendSongIdentityEvent, markSongSourcesPendingAlignment } from './match-management-store'

export type { BindingMethod, BindingStatus, ReviewEvidenceType, ReviewStatus, SongIdentityBinding, MatchReview }
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

type ReviewRow = {
  id: string
  netease_song_id: number
  source_id: string | null
  run_id: string | null
  candidate_plex_file_path: string | null
  candidate_plex_rating_key: string | null
  candidate_mb_recording_id: string | null
  candidate_key: string
  evidence_type: ReviewEvidenceType
  evidence_json: string
  status: ReviewStatus
  decision: string | null
  created_at: string
  decided_at: string | null
}

export interface MatchReviewFilters {
  status?: ReviewStatus
  sourceId?: string
  evidenceType?: ReviewEvidenceType
  page?: number
  pageSize?: number
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

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
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
    evidence: safeJson(row.evidence_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  }
}

function reviewFromRow(row: ReviewRow): MatchReview {
  return {
    id: row.id,
    neteaseSongId: row.netease_song_id,
    sourceId: row.source_id,
    runId: row.run_id,
    candidatePlexFilePath: row.candidate_plex_file_path,
    candidatePlexRatingKey: row.candidate_plex_rating_key,
    candidateMbRecordingId: row.candidate_mb_recording_id,
    evidenceType: REVIEW_EVIDENCE_TYPES.has(row.evidence_type) ? row.evidence_type : 'historical',
    evidence: safeJson(row.evidence_json),
    status: row.status,
    decision: row.decision,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
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
      appendSongIdentityEvent({
        neteaseSongId: binding.neteaseSongId,
        eventType: previous && previous.plexRelativePath !== binding.plexRelativePath ? 'auto_migrate' : 'auto_bind',
        actorType: 'system',
        sourceId: typeof input.evidence.sourceId === 'string' ? input.evidence.sourceId : null,
        runId: typeof input.evidence.runId === 'string' ? input.evidence.runId : null,
        previousBinding: previous,
        nextBinding: binding,
        evidence: input.evidence,
      })
      markSongSourcesPendingAlignment(binding.neteaseSongId)
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
    `).run(JSON.stringify(evidence), now, neteaseSongId)
    const next = getSongIdentityBinding(neteaseSongId)
    appendSongIdentityEvent({
      neteaseSongId,
      eventType: 'invalidate',
      actorType: 'system',
      previousBinding: previous,
      nextBinding: next,
      evidence,
      createdAt: now,
    })
    markSongSourcesPendingAlignment(neteaseSongId, now)
  })()
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
    appendSongIdentityEvent({
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
    markSongSourcesPendingAlignment(neteaseSongId, now)
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
      ) as ReviewRow | undefined
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
      `).get(candidateKey) as ReviewRow | undefined
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
  const row = getDb().prepare('SELECT * FROM song_match_reviews WHERE id = ?').get(id) as ReviewRow | undefined
  return row ? reviewFromRow(row) : null
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
  `).get(input.neteaseSongId, path, ratingKey) as ReviewRow | undefined
  return row ? reviewFromRow(row) : null
}

function buildReviewWhere(filters: Pick<MatchReviewFilters, 'status' | 'sourceId' | 'evidenceType'>, includeStatus = true): {
  where: string
  values: unknown[]
} {
  const conditions: string[] = []
  const values: unknown[] = []
  if (includeStatus && filters.status) {
    conditions.push('r.status = ?')
    values.push(filters.status)
  }
  if (filters.sourceId) {
    conditions.push(`(
      r.source_id = ? OR EXISTS (
        SELECT 1 FROM song_match_review_occurrences occurrence
        WHERE occurrence.review_id = r.id AND occurrence.source_id = ?
      )
    )`)
    values.push(filters.sourceId, filters.sourceId)
  }
  if (filters.evidenceType) {
    conditions.push('r.evidence_type = ?')
    values.push(filters.evidenceType)
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  }
}

function listSourceFacets(db: Database.Database): MatchReviewSourceFacet[] {
  return db.prepare(`
    WITH review_sources AS (
      SELECT id AS review_id, source_id FROM song_match_reviews WHERE source_id IS NOT NULL AND source_id != ''
      UNION
      SELECT review_id, source_id FROM song_match_review_occurrences WHERE source_id != ''
    )
    SELECT review_sources.source_id,
      COALESCE(NULLIF(playlist_sources.name, ''), NULLIF(playlist_sources.netease_playlist_name, ''), review_sources.source_id) AS name,
      COUNT(DISTINCT review_sources.review_id) AS count
    FROM review_sources
    LEFT JOIN playlist_sources ON playlist_sources.id = review_sources.source_id
    GROUP BY review_sources.source_id
    ORDER BY name COLLATE NOCASE ASC, review_sources.source_id ASC
  `).all().map((row: unknown) => {
    const typed = row as { source_id: string; name: string; count: number }
    return { sourceId: typed.source_id, name: typed.name, count: typed.count }
  })
}

function listEvidenceFacets(db: Database.Database): MatchReviewEvidenceFacet[] {
  return (db.prepare(`
    SELECT evidence_type, COUNT(*) AS count
    FROM song_match_reviews
    GROUP BY evidence_type
    ORDER BY count DESC, evidence_type ASC
  `).all() as Array<{ evidence_type: ReviewEvidenceType; count: number }>).map(row => ({
    evidenceType: row.evidence_type,
    count: row.count,
  }))
}

export function queryMatchReviews(filters: MatchReviewFilters = {}): MatchReviewPage {
  const db = getDb()
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 25), 1), 100)
  const requestedPage = Math.max(Math.trunc(filters.page ?? 1), 1)
  const full = buildReviewWhere(filters)
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM song_match_reviews r ${full.where}`)
    .get(...full.values) as { count: number }).count
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages)
  const rows = db.prepare(`
    SELECT r.* FROM song_match_reviews r
    ${full.where}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ? OFFSET ?
  `).all(...full.values, pageSize, (page - 1) * pageSize) as ReviewRow[]
  const reviews = rows.map(reviewFromRow)
  const bindings = getSongIdentityBindings(reviews.map(review => review.neteaseSongId))

  const aggregate = buildReviewWhere(filters, false)
  const countRows = db.prepare(`
    SELECT r.status, COUNT(*) AS count
    FROM song_match_reviews r
    ${aggregate.where}
    GROUP BY r.status
  `).all(...aggregate.values) as Array<{ status: ReviewStatus; count: number }>
  const counts: MatchReviewCounts = {
    pending: 0,
    accepted: 0,
    rejected: 0,
    unbound: 0,
    superseded: 0,
    activeBindings: (db.prepare("SELECT COUNT(*) AS count FROM song_identity_bindings WHERE status = 'active'").get() as { count: number }).count,
  }
  for (const row of countRows) counts[row.status] = row.count

  return {
    items: reviews.map(review => ({ ...review, binding: bindings.get(review.neteaseSongId) ?? null })),
    page,
    pageSize,
    total,
    totalPages,
    counts,
    facets: {
      sources: listSourceFacets(db),
      evidenceTypes: listEvidenceFacets(db),
    },
  }
}

export function listMatchReviews(filters: {
  status?: ReviewStatus
  sourceId?: string
  evidenceType?: ReviewEvidenceType
  limit?: number
} = {}): MatchReview[] {
  const query = buildReviewWhere(filters)
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 100), 1), 500)
  return (getDb().prepare(`
    SELECT r.* FROM song_match_reviews r
    ${query.where}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ?
  `).all(...query.values, limit) as ReviewRow[]).map(reviewFromRow)
}

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
  const row = db.prepare('SELECT * FROM song_match_reviews WHERE id = ?').get(id) as ReviewRow | undefined
  if (!row) throw new Error(`审核记录不存在：${id}`)
  if (row.status !== 'pending') {
    const sameDecision = (decision === 'accept' && row.status === 'accepted')
      || (decision === 'reject' && row.status === 'rejected')
    if (sameDecision) return reviewFromRow(row)
    throw new Error(`审核记录已是“${row.status}”状态，不能再次决策`)
  }

  const review = reviewFromRow(row)
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
    appendSongIdentityEvent({
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
    markSongSourcesPendingAlignment(review.neteaseSongId, now)
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

  const updated = db.prepare('SELECT * FROM song_match_reviews WHERE id = ?').get(id) as ReviewRow
  return reviewFromRow(updated)
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
    appendSongIdentityEvent({
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
    const affectedSources = markSongSourcesPendingAlignment(input.neteaseSongId, now)
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
    appendSongIdentityEvent({
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
    const affectedSources = markSongSourcesPendingAlignment(input.neteaseSongId, now)
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
