import type { SongIdentityBinding } from '../../../types/match-review'
import { getDb } from '../db'
import { parseJsonObject } from '../json'
import {
  normalizePlexPath,
  normalizePlexRelativePath,
} from './identity-normalization'

export { normalizePlexPath } from './identity-normalization'
export type { SongIdentityBinding } from '../../../types/match-review'

type BindingRow = {
  netease_song_id: number
  plex_section_key: string
  plex_file_path: string
  plex_relative_path: string
  plex_rating_key: string | null
  binding_method: SongIdentityBinding['bindingMethod']
  status: SongIdentityBinding['status']
  evidence_json: string
  created_at: string
  updated_at: string
  last_verified_at: string | null
}

export interface BindingInput {
  neteaseSongId: number
  plexSectionKey: string
  plexSectionRoot?: string
  plexFilePath: string
  plexRelativePath?: string
  plexRatingKey: string | null
  bindingMethod: 'path' | 'manual'
  status: SongIdentityBinding['status']
  evidence: Record<string, unknown>
  lastVerifiedAt?: string | null
}

export class BindingVersionConflictError extends Error {
  constructor() {
    super('媒体关联已被其他操作更新，请刷新后重试')
    this.name = 'BindingVersionConflictError'
  }
}

export class BindingIdentityConflictError extends Error {
  constructor() {
    super('该 Plex 媒体已关联到另一首网易云歌曲')
    this.name = 'BindingIdentityConflictError'
  }
}

function fromRow(row: BindingRow): SongIdentityBinding {
  return {
    neteaseSongId: row.netease_song_id,
    plexSectionKey: row.plex_section_key,
    plexFilePath: row.plex_file_path,
    plexRelativePath: row.plex_relative_path,
    plexRatingKey: row.plex_rating_key,
    bindingMethod: row.binding_method,
    status: row.status,
    evidence: parseJsonObject(row.evidence_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  }
}

function nextTimestamp(previous?: string | null): string {
  const now = Date.now()
  const previousMs = previous ? Date.parse(previous) : Number.NaN
  return new Date(Number.isFinite(previousMs) && previousMs >= now ? previousMs + 1 : now).toISOString()
}

function relativePath(filePath: string, root?: string): string {
  const normalizedFile = normalizePlexPath(filePath)
  const normalizedRoot = normalizePlexPath(root ?? '')
  if (!normalizedRoot) return normalizePlexRelativePath(normalizedFile)
  const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`
  return normalizePlexRelativePath(normalizedFile.startsWith(prefix)
    ? normalizedFile.slice(prefix.length)
    : normalizedFile)
}

export function getSongIdentityBinding(neteaseSongId: number): SongIdentityBinding | null {
  const row = getDb().prepare('SELECT * FROM song_identity_bindings WHERE netease_song_id = ?')
    .get(neteaseSongId) as BindingRow | undefined
  return row ? fromRow(row) : null
}

export function getSongIdentityBindings(songIds: number[]): Map<number, SongIdentityBinding> {
  const ids = [...new Set(songIds.filter(Number.isFinite))]
  if (!ids.length) return new Map()
  const rows = getDb().prepare(`
    SELECT * FROM song_identity_bindings
    WHERE netease_song_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as BindingRow[]
  return new Map(rows.map(row => [row.netease_song_id, fromRow(row)]))
}

export function getActiveSongIdentityBindings(songIds: number[]): Map<number, SongIdentityBinding> {
  const bindings = getSongIdentityBindings(songIds)
  for (const [songId, binding] of bindings) {
    if (binding.status !== 'active' || !['path', 'manual'].includes(binding.bindingMethod)) bindings.delete(songId)
  }
  return bindings
}

export function getSongIdentityBindingByRatingKey(ratingKey: string): SongIdentityBinding | null {
  const rows = getDb().prepare(`
    SELECT * FROM song_identity_bindings
    WHERE plex_rating_key = ? AND status = 'active'
      AND binding_method IN ('path', 'manual')
    ORDER BY netease_song_id
    LIMIT 2
  `).all(ratingKey) as BindingRow[]
  return rows.length === 1 ? fromRow(rows[0]!) : null
}

export function upsertSongIdentityBinding(input: BindingInput): SongIdentityBinding {
  const previous = getSongIdentityBinding(input.neteaseSongId)
  const now = nextTimestamp(previous?.updatedAt)
  const plexFilePath = normalizePlexPath(input.plexFilePath)
  const plexRelativePath = input.plexRelativePath === undefined
    ? input.plexSectionRoot
      ? relativePath(plexFilePath, input.plexSectionRoot)
      : previous && normalizePlexPath(previous.plexFilePath) === plexFilePath
        ? previous.plexRelativePath
        : relativePath(plexFilePath)
    : normalizePlexRelativePath(input.plexRelativePath)
  const lastVerifiedAt = Object.prototype.hasOwnProperty.call(input, 'lastVerifiedAt')
    ? input.lastVerifiedAt ?? null
    : now

  getDb().prepare(`
    INSERT INTO song_identity_bindings (
      netease_song_id, plex_section_key, plex_file_path, plex_relative_path,
      plex_rating_key, binding_method, status, evidence_json,
      created_at, updated_at, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(netease_song_id) DO UPDATE SET
      plex_section_key = excluded.plex_section_key,
      plex_file_path = excluded.plex_file_path,
      plex_relative_path = excluded.plex_relative_path,
      plex_rating_key = excluded.plex_rating_key,
      binding_method = excluded.binding_method,
      status = excluded.status,
      evidence_json = excluded.evidence_json,
      updated_at = excluded.updated_at,
      last_verified_at = excluded.last_verified_at
  `).run(
    input.neteaseSongId,
    input.plexSectionKey,
    plexFilePath,
    plexRelativePath,
    input.plexRatingKey,
    input.bindingMethod,
    input.status,
    JSON.stringify(input.evidence),
    previous?.createdAt ?? now,
    now,
    lastVerifiedAt,
  )
  return getSongIdentityBinding(input.neteaseSongId)!
}

export function upsertVerifiedSongIdentityBinding(input: BindingInput): SongIdentityBinding {
  const previous = getSongIdentityBinding(input.neteaseSongId)
  const next = upsertSongIdentityBinding(input)
  const sameIdentity = previous
    && previous.status === next.status
    && previous.bindingMethod === next.bindingMethod
    && previous.plexRelativePath === next.plexRelativePath
  if (sameIdentity) {
    getDb().prepare('UPDATE song_identity_bindings SET updated_at = ? WHERE netease_song_id = ?')
      .run(previous.updatedAt, input.neteaseSongId)
    return getSongIdentityBinding(input.neteaseSongId)!
  }
  return next
}

export function markSongIdentityBindingStale(
  neteaseSongId: number,
  evidence: Record<string, unknown> = {},
): void {
  const current = getSongIdentityBinding(neteaseSongId)
  if (!current || current.status === 'stale') return
  getDb().prepare(`
    UPDATE song_identity_bindings
    SET status = 'stale', evidence_json = ?, updated_at = ?, last_verified_at = ?
    WHERE netease_song_id = ?
  `).run(
    JSON.stringify({ ...current.evidence, ...evidence }),
    nextTimestamp(current.updatedAt),
    new Date().toISOString(),
    neteaseSongId,
  )
}

export function markAutomaticSongIdentityBindingsStale(
  songIds: number[],
  evidence: Record<string, unknown> = {},
): number {
  const bindings = [...getActiveSongIdentityBindings(songIds).values()]
    .filter(binding => binding.bindingMethod === 'path')
  for (const binding of bindings) {
    markSongIdentityBindingStale(binding.neteaseSongId, { ...evidence, reason: 'rebuild_managed_links' })
  }
  return bindings.length
}

function assertVersion(neteaseSongId: number, expected: string | null): SongIdentityBinding | null {
  const current = getSongIdentityBinding(neteaseSongId)
  if ((current?.updatedAt ?? null) !== expected) throw new BindingVersionConflictError()
  return current
}

function assertPlexIdentityAvailable(input: {
  neteaseSongId: number
  plexFilePath: string
  plexRatingKey: string | null
}): void {
  const normalizedPath = normalizePlexPath(input.plexFilePath)
  const conflict = getDb().prepare(`
    SELECT 1
    FROM song_identity_bindings
    WHERE netease_song_id != ?
      AND status = 'active'
      AND binding_method IN ('path', 'manual')
      AND (plex_file_path = ? OR (? IS NOT NULL AND plex_rating_key = ?))
    LIMIT 1
  `).get(input.neteaseSongId, normalizedPath, input.plexRatingKey, input.plexRatingKey)
  if (conflict) throw new BindingIdentityConflictError()
}

function affectedSources(neteaseSongId: number): Array<{ id: string; name: string }> {
  return getDb().prepare(`
    SELECT DISTINCT source.id, COALESCE(NULLIF(source.name, ''), source.netease_playlist_name, source.id) AS name
    FROM playlist_source_track_occurrences occurrence
    JOIN playlist_sources source ON source.id = occurrence.source_id
    WHERE occurrence.netease_song_id = ? AND occurrence.membership_status = 'current'
    ORDER BY source.sort_order, source.id
  `).all(neteaseSongId) as Array<{ id: string; name: string }>
}

function requireRealignment(sources: Array<{ id: string }>): void {
  if (!sources.length) return
  getDb().prepare(`
    UPDATE playlist_sources
    SET requires_match_reconcile = 1, updated_at = ?
    WHERE id IN (${sources.map(() => '?').join(',')})
  `).run(new Date().toISOString(), ...sources.map(source => source.id))
}

export function rebindSongIdentity(input: {
  neteaseSongId: number
  expectedBindingUpdatedAt: string | null
  sourceId?: string
  binding: Omit<BindingInput, 'neteaseSongId' | 'bindingMethod' | 'status'>
}): { binding: SongIdentityBinding; affectedSources: Array<{ id: string; name: string }> } {
  const db = getDb()
  return db.transaction(() => {
    assertVersion(input.neteaseSongId, input.expectedBindingUpdatedAt)
    assertPlexIdentityAvailable({
      neteaseSongId: input.neteaseSongId,
      plexFilePath: input.binding.plexFilePath,
      plexRatingKey: input.binding.plexRatingKey,
    })
    const binding = upsertSongIdentityBinding({
      ...input.binding,
      neteaseSongId: input.neteaseSongId,
      bindingMethod: 'manual',
      status: 'active',
      evidence: { ...input.binding.evidence, source: 'explicit_adoption', sourceId: input.sourceId ?? null },
    })
    const sources = affectedSources(input.neteaseSongId)
    requireRealignment(sources)
    return { binding, affectedSources: sources }
  })()
}

export function unbindSongIdentityWithMode(input: {
  neteaseSongId: number
  expectedBindingUpdatedAt: string
  mode: 'reevaluate' | 'exclude_current'
  sourceId?: string
}): { binding: SongIdentityBinding; affectedSources: Array<{ id: string; name: string }> } {
  const db = getDb()
  return db.transaction(() => {
    const current = assertVersion(input.neteaseSongId, input.expectedBindingUpdatedAt)
    if (!current) throw new BindingVersionConflictError()
    const now = nextTimestamp(current.updatedAt)
    db.prepare(`
      UPDATE song_identity_bindings
      SET status = 'unbound', evidence_json = ?, updated_at = ?
      WHERE netease_song_id = ?
    `).run(JSON.stringify({
      ...current.evidence,
      cancelledAdoption: true,
      sourceId: input.sourceId ?? null,
    }), now, input.neteaseSongId)
    const sources = affectedSources(input.neteaseSongId)
    requireRealignment(sources)
    return { binding: getSongIdentityBinding(input.neteaseSongId)!, affectedSources: sources }
  })()
}
