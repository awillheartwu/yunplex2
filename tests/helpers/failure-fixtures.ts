import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeConfig } from '~~/server/lib/config/store'
import { closeDb, getDb, initDb } from '~~/server/lib/db'

export interface FailureTestDatabase {
  directory: string
  cleanup: () => void
}

export function createFailureTestDatabase(
  prefix = 'reyunplex-failure-',
  maxFailureAttempts = 3,
): FailureTestDatabase {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  initDb(directory)
  writeConfig({
    sync: {
      enabled: false,
      initializeMediaOnFirstSync: false,
      maxFailureAttempts,
    },
  })
  return {
    directory,
    cleanup: () => {
      closeDb()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

export function insertFailureSource(
  id = 'source-1',
  options: {
    now?: Date
    intervalMinutes?: number
    lastSyncedAt?: Date | null
  } = {},
): void {
  const now = (options.now ?? new Date()).toISOString()
  getDb().prepare(`
    INSERT INTO playlist_sources (
      id, netease_playlist_id, name, enabled, netease_playlist_name,
      initialize_media_on_first_sync, sync_interval_minutes, last_synced_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, 0, ?, ?, ?, ?)
  `).run(
    id,
    Number(id.replace(/\D/g, '')) || 1,
    id,
    id,
    options.intervalMinutes ?? null,
    options.lastSyncedAt?.toISOString() ?? null,
    now,
    now,
  )
}

export function insertCurrentTrackOccurrence(
  sourceId: string,
  songId: number,
  position = 0,
  now = new Date(),
): void {
  const nowIso = now.toISOString()
  getDb().prepare(`
    INSERT INTO playlist_source_track_occurrences (
      id, source_id, netease_song_id, occurrence, position, title,
      membership_status, first_observed_at, last_observed_at
    ) VALUES (?, ?, ?, 0, ?, ?, 'current', ?, ?)
  `).run(`occurrence-${sourceId}-${songId}-${position}`, sourceId, songId, position, `Song ${songId}`, nowIso, nowIso)
}
