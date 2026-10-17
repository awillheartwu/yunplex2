import { statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { AppConfig } from '../config/types'
import { getDb } from '../db'
import { getSource } from '../playlist/store'
import { findTracksByFilePath } from '../plex-client'
import { validateLocalAudioFile } from '../media-validation'
import { resolveInitializationGate } from '../source-initialization/gate'
import { getMediaCorrection } from './media-corrections'
import { normalizePlexPath } from './identity-normalization'
import { mapLocalPathToPlex } from './path-map'
import { persistSourceRequest } from './request-store'
import { captureBindingVersions } from './identity-coordinator'

interface PendingFile {
  source_id: string
  song_id: number
  file_path: string
  file_size: number | null
  file_mtime_ms: number | null
}

export function plexRecoveryConfigFingerprint(config: AppConfig): string {
  return createHash('sha256').update(JSON.stringify([config.plex, config.download.dir,
    config.download.plexLibraryPathPrefix, config.sync.songLimit])).digest('hex')
}

/** Only open indexing failures for current targets and unchanged managed files qualify. */
export async function findIndexedRecoverySources(config: AppConfig, sectionKey: string, signal: AbortSignal): Promise<Map<string, string>> {
  const rows = getDb().prepare(`SELECT DISTINCT f.source_id, f.song_id, a.file_path, a.file_size, a.file_mtime_ms
    FROM failure_records f
    JOIN playlist_sources s ON s.id=f.source_id AND s.enabled=1 AND s.type='playlist'
    JOIN playlist_source_track_occurrences o ON o.source_id=s.id AND o.netease_song_id=f.song_id
      AND o.membership_status='current' AND o.last_song_status='failed_plex_match'
    JOIN local_media_assets a ON a.netease_song_id=f.song_id AND a.ownership='managed' AND a.status='active'
    LEFT JOIN song_identity_bindings b ON b.netease_song_id=f.song_id
    WHERE f.status='open' AND f.failure_kind='failed_plex_match'
      AND NOT EXISTS (SELECT 1 FROM failure_records other WHERE other.source_id=s.id AND other.status IN ('open','paused') AND other.failure_kind!='failed_plex_match')
      AND NOT EXISTS (SELECT 1 FROM playlist_source_track_occurrences other WHERE other.source_id=s.id
        AND other.membership_status='current' AND other.last_song_status IN ('failed_download','failed_tags','failed_plex_insert','copyright_restricted','ignored_failure'))
      AND NOT EXISTS (SELECT 1 FROM failure_records ignored JOIN playlist_source_track_occurrences target
        ON target.source_id=ignored.source_id AND target.netease_song_id=ignored.song_id AND target.membership_status='current'
        WHERE ignored.source_id=s.id AND ignored.status IN ('ignored','paused'))
      AND (b.binding_method IS NULL OR b.binding_method!='manual')
      AND (b.status IS NULL OR b.status!='unbound')`).all() as PendingFile[]
  const ready = new Map<string, string[]>()
  for (const row of rows) {
    signal.throwIfAborted()
    const source = getSource(row.source_id)
    if (!source || resolveInitializationGate(source, config).action !== 'sync' || getMediaCorrection(row.song_id)) continue
    const path = mapLocalPathToPlex(row.file_path, config)
    if (!path || !unchangedFile(row)) continue
    const tracks = await findTracksByFilePath(sectionKey, path)
    signal.throwIfAborted()
    const exact = tracks.filter(track => track.Media?.some(media => media.Part?.some(part =>
      part.file && normalizePlexPath(part.file) === normalizePlexPath(path),
    )))
    if (new Set(exact.map(track => track.ratingKey)).size !== 1) continue
    const items = ready.get(source.id) ?? []
    items.push(`${row.song_id}:${exact[0]!.ratingKey}`)
    ready.set(source.id, items)
  }
  return new Map([...ready].map(([id, items]) => [id, items.sort().join(',')]))
}

function unchangedFile(row: PendingFile): boolean {
  try {
    const stat = statSync(row.file_path)
    return stat.isFile()
      && (row.file_size === null || stat.size === row.file_size)
      && (row.file_mtime_ms === null || Math.trunc(stat.mtimeMs) === row.file_mtime_ms)
      && validateLocalAudioFile(row.file_path).valid
  } catch { return false }
}

export function enqueueIndexedRecovery(sourceId: string, config: AppConfig): boolean {
  return getDb().transaction(() => {
    const source = getSource(sourceId)
    if (!config.sync.enabled || !source?.enabled || !source.plexPlaylistRatingKey
      || resolveInitializationGate(source, config).action !== 'sync') return false
    if (getDb().prepare("SELECT 1 FROM source_sync_queue WHERE source_id=? AND status IN ('pending','running')").get(sourceId)) return false
    const plexFingerprint = source.lastAppliedPlexFingerprint ?? source.lastObservedPlexFingerprint
    if (!source.lastComparedNeteaseCursor || !plexFingerprint) return false
    const targets = getDb().prepare("SELECT netease_song_id AS id FROM playlist_source_track_occurrences WHERE source_id=? AND membership_status='current'").all(sourceId) as Array<{ id: number }>
    persistSourceRequest({ sourceId, kind: 'plex_recovery', trigger: 'system', plexRecoverySnapshot: {
      configFingerprint: plexRecoveryConfigFingerprint(config),
      playlistRatingKey: source.plexPlaylistRatingKey,
      neteaseCursor: source.lastComparedNeteaseCursor,
      plexFingerprint,
      bindingVersions: [...captureBindingVersions(targets.map(song => song.id))],
    } })
    return true
  })()
}
