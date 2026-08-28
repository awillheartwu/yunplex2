import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import { commitCompletedMediaWrite } from '../download/media-write'
import { getLocalMediaAsset, inspectLocalMediaAssets, persistLocalMediaInspection, resolveLocalMediaAsset, upsertLocalMediaAsset } from './local-media-store'

let tempDir: string | null = null
afterEach(() => {
  closeDb()
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'reyunplex-local-media-'))
  initDb(tempDir)
  return tempDir
}

const song: NeteaseSong = {
  id: 497572729,
  name: '人生浪费指南',
  no: 1,
  dt: 353676,
  disc: '1',
  artists: [{ name: '夏日入侵企画' }],
  album: { id: 84153693, name: '砳', picUrl: '', publishTime: 1502452431422 },
}

function config(downloadDir: string): AppConfig {
  return {
    netease: { cookie: '', quality: 'jymaster' },
    plex: { server: '', port: 32400, token: '', section: '音乐' },
    download: { dir: downloadDir, plexLibraryPathPrefix: '/music', downloadLyrics: true, embedMetadata: true, embedCover: true, saveAlbumCover: false, saveArtistImage: false },
    sync: { intervalMinutes: 30, songLimit: 10, downloadConcurrency: 3, plexScanRetries: 5, plexScanRetryDelaySec: 15, enabled: false, logRetentionDays: 30, jobRetentionSuccessDays: 7, jobRetentionFailedDays: 30, downloadTaskRetentionDays: 30, forceFullCompare: false, downloadWhenMediaMissing: false, reconcileOnPlexDrift: true, fullCompareAfterSkips: 5, fullCompareAfterDays: 7, autoDownloadAlbum: false, skipPlexPlaylist: false, skipRemoveExtraTracks: false, extraTrackRemovalPolicy: 'balanced', maxFailureAttempts: 3, unverifiedMediaPolicy: 'download_managed' },
    other: { multiArtistFormat: 'ampersand', lyricOrder: 'original_first', downloadTranslatedLyric: true, downloadRomajiLyric: false, artistAliases: {}, applyAliasToAlbum: false, pathFormat: '{artist}/{album} ({year})/{track:02d} - {title}', fontScale: 1, enableMusicBrainzResolver: false, musicBrainzMinScore: 90 },
  }
}

describe('local media provenance', () => {
  it('adopts the newest successful download path that still exists', () => {
    const root = setup()
    const existing = join(root, 'legacy.flac')
    writeFileSync(existing, 'audio')
    const now = new Date().toISOString()
    getDb().prepare(`INSERT INTO download_tasks (id, song_id, song_name, status, file_path, created_at, updated_at) VALUES (?, ?, ?, 'done', ?, ?, ?)`)
      .run('task-existing', song.id, song.name, existing, now, now)

    const result = resolveLocalMediaAsset(song, config(root))

    expect(result).toMatchObject({ filePath: existing, provenance: 'legacy_download_task', sourceTaskId: 'task-existing', status: 'active' })
  })

  it('keeps provenance after the queue history is deleted', () => {
    const root = setup()
    const existing = join(root, 'durable.flac')
    writeFileSync(existing, 'audio')
    const now = new Date().toISOString()
    getDb().prepare(`INSERT INTO download_tasks (id, song_id, song_name, status, file_path, created_at, updated_at) VALUES (?, ?, ?, 'done', ?, ?, ?)`)
      .run('task-durable', song.id, song.name, existing, now, now)
    resolveLocalMediaAsset(song, config(root))
    getDb().prepare('DELETE FROM download_tasks').run()

    expect(resolveLocalMediaAsset(song, config(root))?.filePath).toBe(existing)
    expect(getLocalMediaAsset(song.id)?.status).toBe('active')
  })

  it('skips a newer stale task and recovers an older existing path', () => {
    const root = setup()
    const existing = join(root, 'older.flac')
    writeFileSync(existing, 'audio')
    getDb().prepare(`INSERT INTO download_tasks (id, song_id, song_name, status, file_path, created_at, updated_at) VALUES (?, ?, ?, 'done', ?, ?, ?)`)
      .run('older', song.id, song.name, existing, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    getDb().prepare(`INSERT INTO download_tasks (id, song_id, song_name, status, file_path, created_at, updated_at) VALUES (?, ?, ?, 'done', ?, ?, ?)`)
      .run('newer-missing', song.id, song.name, join(root, 'missing.flac'), '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')

    expect(resolveLocalMediaAsset(song, config(root))?.sourceTaskId).toBe('older')
  })

  it('marks a managed asset replaced when its file changes outside a managed write', () => {
    const root = setup()
    const filePath = join(root, 'managed.flac')
    writeFileSync(filePath, 'first')
    upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })
    writeFileSync(filePath, 'replacement-audio')

    expect(resolveLocalMediaAsset(song, config(root))).toMatchObject({
      filePath,
      ownership: 'managed',
      status: 'replaced',
      evidence: expect.objectContaining({
        replacementDetected: true,
        previousFileSize: 5,
        observedFileSize: 17,
      }),
    })
  })

  it('reactivates a missing managed asset when the same file becomes visible again', () => {
    const root = setup()
    const filePath = join(root, 'temporarily-unavailable.flac')
    writeFileSync(filePath, 'audio')
    upsertLocalMediaAsset({
      neteaseSongId: song.id,
      filePath,
      provenance: 'download_task',
      ownership: 'managed',
      evidence: { audioOperation: 'downloaded' },
    })
    getDb().prepare("UPDATE local_media_assets SET status = 'missing' WHERE netease_song_id = ?").run(song.id)

    const inspection = inspectLocalMediaAssets([song], config(root)).get(song.id)
    expect(inspection?.state).toBe('active_managed')
    expect(inspection && persistLocalMediaInspection(inspection)).toMatchObject({ status: 'active' })
  })

  it('marks every current source occurrence for exact-path reconciliation after a managed download', () => {
    const root = setup()
    const filePath = join(root, 'new-managed.flac')
    writeFileSync(filePath, 'managed-audio')
    const now = new Date().toISOString()
    getDb().prepare(`
      INSERT INTO playlist_sources (id, netease_playlist_id, name, requires_match_reconcile, created_at, updated_at)
      VALUES ('source-one', 1, '来源一', 0, ?, ?)
    `).run(now, now)
    getDb().prepare(`
      INSERT INTO playlist_source_track_occurrences (
        id, source_id, netease_song_id, occurrence, position, title,
        artists_json, metadata_complete, membership_status, first_observed_at, last_observed_at
      ) VALUES ('source-one:song:0', 'source-one', ?, 0, 0, '歌曲', '[]', 1, 'current', ?, ?)
    `).run(song.id, now, now)

    commitCompletedMediaWrite({
      neteaseSongId: song.id,
      filePath,
      provenance: 'download_task',
      taskId: 'manual-task',
      audioDownloaded: true,
    })

    expect(getDb().prepare('SELECT requires_match_reconcile FROM playlist_sources WHERE id = ?')
      .get('source-one')).toEqual({ requires_match_reconcile: 1 })
  })
})
