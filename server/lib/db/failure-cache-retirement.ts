import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { failureFingerprint, failureSubjectKey } from '../tasks/failure-identity'
import { tableExists } from './introspection'

interface LegacyFailureMemoryEntry {
  count?: unknown
  lastStatus?: unknown
  lastMessage?: unknown
  updatedAt?: unknown
}

function legacyIntegerIds(value: string | null): number[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed
      .map(item => Number(item))
      .filter(item => Number.isSafeInteger(item) && item > 0))]
  } catch {
    return []
  }
}

function legacyFailureMemory(value: string | null): Array<{
  songId: number
  count: number
  failureKind: string
  reason: string
  occurredAt?: string
}> {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as Record<string, number | LegacyFailureMemoryEntry>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return Object.entries(parsed).flatMap(([songIdText, raw]) => {
      const songId = Number(songIdText)
      const entry = typeof raw === 'number' ? { count: raw } : raw
      const count = Math.floor(Number(entry?.count) || 0)
      if (!Number.isSafeInteger(songId) || songId <= 0 || !entry || count <= 0) return []
      const failureKind = typeof entry.lastStatus === 'string'
        && ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(entry.lastStatus)
        ? entry.lastStatus
        : 'failed_download'
      return [{
        songId,
        count,
        failureKind,
        reason: typeof entry.lastMessage === 'string' ? entry.lastMessage : '历史来源失败记录',
        occurredAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
      }]
    })
  } catch {
    return []
  }
}

function artistLabel(raw: string | undefined): string {
  try {
    const artists = JSON.parse(raw || '[]') as unknown
    if (!Array.isArray(artists)) return ''
    return artists.map((value) => {
      if (typeof value === 'string') return value
      if (value && typeof value === 'object' && 'name' in value) return String(value.name)
      return ''
    }).filter(Boolean).join(' / ')
  } catch {
    return ''
  }
}

/** Move cross-run failure policy into failure_records, then remove source JSON caches. */
export function retirePlaylistSourceFailureCaches(d: Database.Database): void {
  if (!tableExists(d, 'playlist_sources') || !tableExists(d, 'failure_records')) return
  const columns = new Set(
    (d.prepare("PRAGMA table_info('playlist_sources')").all() as Array<{ name: string }>).map(column => column.name),
  )
  const hasCopyright = columns.has('copyright_restricted_ids')
  const hasFailureMemory = columns.has('ignored_failure_ids')
  if (!hasCopyright && !hasFailureMemory) return

  const sources = d.prepare(`
    SELECT id, name, netease_playlist_name, updated_at,
      ${hasCopyright ? 'copyright_restricted_ids' : 'NULL'} AS copyright_restricted_ids,
      ${hasFailureMemory ? 'ignored_failure_ids' : 'NULL'} AS ignored_failure_ids
    FROM playlist_sources
  `).all() as Array<{
    id: string
    name: string
    netease_playlist_name: string
    updated_at: string
    copyright_restricted_ids: string | null
    ignored_failure_ids: string | null
  }>
  const occurrence = tableExists(d, 'playlist_source_track_occurrences')
    ? d.prepare(`
        SELECT title, artists_json
        FROM playlist_source_track_occurrences
        WHERE source_id = ? AND netease_song_id = ?
        ORDER BY CASE membership_status WHEN 'current' THEN 0 ELSE 1 END, position
        LIMIT 1
      `)
    : null
  const upsert = d.prepare(`
    INSERT INTO failure_records (
      id, fingerprint, subject_key, song_id, song_name, artist, source_id,
      source_name, run_id, run_type, failure_kind, failure_reason, status,
      first_seen_at, last_seen_at, ignored_at, resolved_at,
      occurrence_count, retry_count, download_task_ids
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'sync', ?, ?, 'open', ?, ?, NULL, NULL, ?, 0, NULL)
    ON CONFLICT(fingerprint) DO UPDATE SET
      song_name = excluded.song_name,
      artist = excluded.artist,
      source_name = excluded.source_name,
      failure_reason = CASE
        WHEN failure_records.failure_reason = '' THEN excluded.failure_reason
        ELSE failure_records.failure_reason
      END,
      status = CASE WHEN failure_records.status = 'ignored' THEN 'ignored' ELSE 'open' END,
      resolved_at = NULL,
      first_seen_at = MIN(failure_records.first_seen_at, excluded.first_seen_at),
      last_seen_at = MAX(failure_records.last_seen_at, excluded.last_seen_at),
      occurrence_count = MAX(failure_records.occurrence_count, excluded.occurrence_count)
  `)
  const insertOccurrence = d.prepare(`
    INSERT OR IGNORE INTO failure_occurrences (fingerprint, occurrence_key, occurred_at)
    VALUES (?, ?, ?)
  `)

  d.transaction(() => {
    for (const source of sources) {
      const sourceName = source.name || source.netease_playlist_name || source.id
      const entries = [
        ...legacyIntegerIds(source.copyright_restricted_ids).map(songId => ({
          songId,
          count: 1,
          failureKind: 'copyright_restricted',
          reason: '历史来源记录：版权受限',
          occurredAt: source.updated_at,
        })),
        ...legacyFailureMemory(source.ignored_failure_ids),
      ]
      for (const entry of entries) {
        const metadata = occurrence?.get(source.id, entry.songId) as { title: string; artists_json: string } | undefined
        const artist = artistLabel(metadata?.artists_json)
        const songName = metadata?.title || `网易云歌曲 #${entry.songId}`
        const identity = {
          songId: entry.songId,
          songName,
          artist,
          sourceId: source.id,
          failureKind: entry.failureKind,
        }
        const fingerprint = failureFingerprint(identity)
        const occurredAt = entry.occurredAt || source.updated_at
        upsert.run(
          randomUUID(),
          fingerprint,
          failureSubjectKey(identity),
          entry.songId,
          songName,
          artist,
          source.id,
          sourceName,
          entry.failureKind,
          entry.reason,
          occurredAt,
          occurredAt,
          entry.count,
        )
        insertOccurrence.run(
          fingerprint,
          `legacy-source-cache:${source.id}:${entry.songId}:${entry.failureKind}`,
          occurredAt,
        )
      }
    }
    d.prepare(`
      UPDATE failure_records
      SET status = 'resolved', resolved_at = COALESCE(resolved_at, last_seen_at)
      WHERE failure_kind = 'ignored_failure' AND status IN ('open', 'ignored')
    `).run()
    if (hasCopyright) d.prepare('ALTER TABLE playlist_sources DROP COLUMN copyright_restricted_ids').run()
    if (hasFailureMemory) d.prepare('ALTER TABLE playlist_sources DROP COLUMN ignored_failure_ids').run()
  })()
}
