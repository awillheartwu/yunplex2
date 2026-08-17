import type Database from 'better-sqlite3'
import { getDb } from '../db'
import type {
  MatchReview,
  MatchReviewCounts,
  MatchReviewEvidenceFacet,
  MatchReviewPage,
  MatchReviewSourceFacet,
  ReviewEvidenceType,
  ReviewStatus,
  SongIdentityBinding,
} from '~~/types/match-review'
import { mapMatchReviewRow, type MatchReviewRow } from './match-review-record'

export interface MatchReviewFilters {
  status?: ReviewStatus
  sourceId?: string
  evidenceType?: ReviewEvidenceType
  page?: number
  pageSize?: number
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

export function queryMatchReviewsReadModel(
  filters: MatchReviewFilters = {},
  getSongIdentityBindings: (songIds: number[]) => Map<number, SongIdentityBinding>,
): MatchReviewPage {
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
  `).all(...full.values, pageSize, (page - 1) * pageSize) as MatchReviewRow[]
  const reviews = rows.map(mapMatchReviewRow)
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
  `).all(...query.values, limit) as MatchReviewRow[]).map(mapMatchReviewRow)
}

