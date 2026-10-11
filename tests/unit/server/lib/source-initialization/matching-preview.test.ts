import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb, writeConfigToDb } from '~~/server/lib/db'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { matchingPreset } from '~~/shared/initialization-matching'

const fetchPlaylistSongs = vi.fn(async () => ({ trackIds: [{ id: 42 }, { id: 99 }], songs: [{ id: 42, name: '再见', no: 1, dt: 180000, disc: '1', artists: [{ name: 'Alpha' }], album: { id: 1, name: 'Single', picUrl: '', publishTime: 0 } }] }))
const getSectionTracks = vi.fn(async () => [{ ratingKey: '100', title: '再見', grandparentTitle: 'Alpha', parentTitle: 'Single', index: 1, duration: 180000, Media: [{ Part: [{ file: '/music/Signal.flac' }] }] }])
vi.mock('~~/server/lib/netease', () => ({ fetchPlaylistSongs }))
vi.mock('~~/server/lib/plex-client', () => ({ initPlexClient: vi.fn(), getSectionKey: vi.fn(async () => '1'), getSectionTracks }))
let directory = ''
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-matching-preview-'))
  initDb(directory)
  getDb().prepare("INSERT INTO playlist_sources (id, netease_playlist_id, name, created_at, updated_at) VALUES ('preview-source', 1, 'Preview source', 'now', 'now')").run()
})
afterEach(() => { closeDb(); rmSync(directory, { recursive: true, force: true }); vi.clearAllMocks(); vi.useRealTimers() })

describe('same-snapshot matching preview', () => {
  it('compares draft parameters without writing config, identities, plans, queues, or runs', async () => {
    const { previewMatching } = await import('~~/server/lib/source-initialization/matching-preview')
    const before = getDb().prepare('SELECT value FROM config').all()
    const result = await previewMatching({ sourceId: 'preview-source', config: matchingPreset('balanced') })
    expect(result.before.unmatched).toBe(1)
    expect(result.after.recommended).toBe(1)
    expect(result.after.metadataMissing).toBe(1)
    expect(result.items[0]).toMatchObject({ before: 'unmatched', after: 'high_confidence', change: 'added' })
    expect(fetchPlaylistSongs).toHaveBeenCalledWith(1, 10, '', { preserveArtistNames: true })
    const rerun = await previewMatching({ sourceId: 'preview-source', config: { ...matchingPreset('balanced'), foldChinese: false, metadataFallback: false }, snapshotId: result.snapshotId })
    expect(rerun.snapshotId).toBe(result.snapshotId)
    expect(rerun.capturedAt).toBe(result.capturedAt)
    expect(rerun.after.unmatched).toBe(1)
    expect(fetchPlaylistSongs).toHaveBeenCalledOnce()
    expect(getSectionTracks).toHaveBeenCalledOnce()
    expect(getDb().prepare('SELECT value FROM config').all()).toEqual(before)
    for (const table of ['source_initializations', 'source_initialization_items', 'source_sync_queue', 'download_tasks', 'song_identity_bindings', 'task_runs']) expect(getDb().prepare(`SELECT COUNT(*) count FROM ${table}`).get()).toEqual({ count: 0 })
  })
  it('retains legacy alias inputs when an enhanced snapshot is compared with enhancement off', async () => {
    const { previewMatching } = await import('~~/server/lib/source-initialization/matching-preview')
    writeConfigToDb({ ...structuredClone(DEFAULT_CONFIG), other: { ...DEFAULT_CONFIG.other, artistAliases: { Alpha: 'Another' } }, initializationMatching: matchingPreset('balanced') })
    getSectionTracks.mockResolvedValueOnce([{ ratingKey: '100', title: '再见', grandparentTitle: 'Alpha', parentTitle: 'Single', index: 1, duration: 180000, Media: [{ Part: [{ file: '/music/Signal.flac' }] }] }])
    const first = await previewMatching({ sourceId: 'preview-source', config: matchingPreset('balanced') })
    expect(first.before.recommended).toBe(1)
    const second = await previewMatching({ sourceId: 'preview-source', config: { ...matchingPreset('balanced'), enabled: false }, snapshotId: first.snapshotId })
    expect(second.after.recommended).toBe(0)
    expect(second.after.review).toBe(1)
    expect(getSectionTracks).toHaveBeenCalledOnce()
  })

  it('freezes baseline parameters and reports expired/wrong-source snapshots', async () => {
    const { previewMatching } = await import('~~/server/lib/source-initialization/matching-preview')
    const first = await previewMatching({ sourceId: 'preview-source', config: matchingPreset('balanced') })
    await expect(previewMatching({ sourceId: 'preview-source', config: matchingPreset('balanced'), snapshotId: first.snapshotId, initializationId: 'obsolete-draft' })).rejects.toThrow('接管草案已变化')
    writeConfigToDb({ ...structuredClone(DEFAULT_CONFIG), initializationMatching: matchingPreset('balanced') })
    const repeated = await previewMatching({ sourceId: 'preview-source', config: matchingPreset('balanced'), snapshotId: first.snapshotId })
    expect(repeated.before.unmatched).toBe(1)
    await expect(previewMatching({ sourceId: 'other', config: matchingPreset('balanced'), snapshotId: first.snapshotId })).rejects.toThrow('不属于')
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 21 * 60000)
    await expect(previewMatching({ sourceId: 'preview-source', config: matchingPreset('balanced'), snapshotId: first.snapshotId })).rejects.toThrow('过期')
  })
})
