import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../db'
import { getRun } from '../run/store'

const fetchPlaylistSongs = vi.fn(async () => ({
  name: 'Production-sized source',
  trackIds: [{ id: 42 }],
  songs: [{
    id: 42,
    name: 'Signal',
    no: 1,
    dt: 180_000,
    disc: '1',
    artists: [{ name: 'Alpha' }],
    album: { id: 1, name: 'Night Drive', picUrl: '', publishTime: 0 },
  }],
}))
const getSectionTracks = vi.fn(async () => [{
  ratingKey: '100',
  title: 'Signal',
  grandparentTitle: 'Alpha',
  parentTitle: 'Night Drive',
  index: 1,
  duration: 180_000,
  Media: [{ Part: [{ file: '/music/Signal.flac' }] }],
}])

vi.mock('../netease', () => ({ fetchPlaylistSongs }))
vi.mock('../plex-client', () => ({
  initPlexClient: vi.fn(async () => undefined),
  getSectionKey: vi.fn(async () => '1'),
  getSectionTracks,
  getTrackByRatingKey: vi.fn(),
}))

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-initialization-service-'))
  initDb(directory)
  const now = new Date().toISOString()
  getDb().prepare(`INSERT INTO playlist_sources (
    id, netease_playlist_id, name, enabled, netease_playlist_name, created_at, updated_at
  ) VALUES ('source-1', 1, 'Source', 0, 'Source', ?, ?)`)
    .run(now, now)
})

afterEach(() => {
  closeDb()
  rmSync(directory, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('source initialization analysis hard gate', () => {
  it('reaches awaiting review without downloads, Plex writes, or identity writes', async () => {
    const { analyzeSourceInitialization } = await import('./service')
    const result = await analyzeSourceInitialization('source-1', 'user')
    const initialization = getDb().prepare('SELECT status, total_items, started_at, analyzed_at FROM source_initializations WHERE id = ?')
      .get(result.initializationId) as { status: string; total_items: number; started_at: string; analyzed_at: string }

    expect(initialization).toMatchObject({ status: 'awaiting_review', total_items: 1 })
    const run = getRun(result.runId)
    expect(run?.status).toBe('awaiting_action')
    expect(run?.durationMs).toBe(Date.parse(initialization.analyzed_at) - Date.parse(run!.startedAt))
    expect(getDb().prepare('SELECT COUNT(*) count FROM download_tasks').get()).toEqual({ count: 0 })
    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_media_decisions').get()).toEqual({ count: 0 })
    expect(fetchPlaylistSongs).toHaveBeenCalledOnce()
    expect(getSectionTracks).toHaveBeenCalledOnce()
  })

  it('persists and deduplicates analysis requests before execution', async () => {
    const { requestSourceInitialization } = await import('./requests')
    const first = requestSourceInitialization('source-1', 'user')
    const repeated = requestSourceInitialization('source-1', 'schedule')
    expect(repeated).toEqual(first)
    expect(getSectionTracks).not.toHaveBeenCalled()
    expect(getDb().prepare("SELECT COUNT(*) count FROM source_sync_queue WHERE status='pending'").get()).toEqual({ count: 1 })
    expect(getRun(first.runId)?.summary).toContain('等待分析')
  })

  it('cancels an active analysis and retries with a new initialization', async () => {
    let releaseScan!: () => void
    getSectionTracks.mockImplementationOnce(() => new Promise(resolve => {
      releaseScan = () => resolve([])
    }))
    const { cancelSourceInitialization, analyzeSourceInitialization } = await import('./service')
    const { getInitialization } = await import('./store')
    const first = analyzeSourceInitialization('source-1', 'user')
    await vi.waitFor(() => expect(getSectionTracks).toHaveBeenCalledOnce())

    expect(cancelSourceInitialization('source-1')).toBe(true)
    releaseScan()
    await expect(first).rejects.toThrow()
    const cancelledId = (getDb().prepare("SELECT id FROM source_initializations WHERE status='cancelled'").get() as { id: string }).id
    expect(getInitialization(cancelledId)?.status).toBe('cancelled')

    const retried = await analyzeSourceInitialization('source-1', 'retry')
    expect(retried.initializationId).not.toBe(cancelledId)
    expect(getInitialization(retried.initializationId)?.status).toBe('awaiting_review')
  })

  it('rolls back every decision when finalizing the initialization run fails', async () => {
    const { commitSourceInitialization, analyzeSourceInitialization } = await import('./service')
    const { getInitialization, setInitializationDecisions } = await import('./store')
    const analyzed = await analyzeSourceInitialization('source-1', 'user')
    setInitializationDecisions({
      initializationId: analyzed.initializationId,
      tier: 'high_confidence',
      decision: 'adopt',
    })
    getDb().exec(`
      CREATE TRIGGER reject_initialization_run_finalize
      BEFORE UPDATE ON task_runs
      WHEN NEW.id = '${analyzed.runId}' AND NEW.status IN ('success', 'partial')
      BEGIN
        SELECT RAISE(ABORT, 'simulated run persistence failure');
      END;
    `)

    await expect(commitSourceInitialization(analyzed.initializationId))
      .rejects.toThrow('simulated run persistence failure')

    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_media_decisions').get()).toEqual({ count: 0 })
    expect(getInitialization(analyzed.initializationId)).toMatchObject({ status: 'awaiting_review' })
  })

  it('does not disguise an unexpected identity persistence failure as a review conflict', async () => {
    const { commitSourceInitialization, analyzeSourceInitialization } = await import('./service')
    const { getInitialization, setInitializationDecisions } = await import('./store')
    const analyzed = await analyzeSourceInitialization('source-1', 'user')
    setInitializationDecisions({
      initializationId: analyzed.initializationId,
      tier: 'high_confidence',
      decision: 'adopt',
    })
    getDb().exec(`
      CREATE TRIGGER reject_identity_persistence
      BEFORE INSERT ON song_identity_bindings
      BEGIN
        SELECT RAISE(ABORT, 'simulated identity persistence failure');
      END;
    `)

    await expect(commitSourceInitialization(analyzed.initializationId))
      .rejects.toThrow('simulated identity persistence failure')

    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_media_decisions').get()).toEqual({ count: 0 })
    expect(getInitialization(analyzed.initializationId)).toMatchObject({ status: 'awaiting_review' })
    expect(getRun(analyzed.runId)?.status).toBe('awaiting_action')
  })

  it('does not let a skip race overwrite active analysis or application', async () => {
    const { skipSourceInitialization } = await import('./service')
    const { ensurePendingInitialization, getInitialization, setInitializationStatus } = await import('./store')
    const initialization = ensurePendingInitialization('source-1', 'user')

    for (const status of ['analyzing', 'applying'] as const) {
      setInitializationStatus(initialization.id, status)
      expect(() => skipSourceInitialization('source-1')).toThrow('正在处理，不能跳过')
      expect(getInitialization(initialization.id)?.status).toBe(status)
    }
  })

  it('does not restart analysis while a reviewed plan is applying', async () => {
    const { analyzeSourceInitialization } = await import('./service')
    const { ensurePendingInitialization, getInitialization, setInitializationStatus } = await import('./store')
    const initialization = ensurePendingInitialization('source-1', 'user')
    setInitializationStatus(initialization.id, 'applying')

    await expect(analyzeSourceInitialization('source-1', 'user')).rejects.toThrow('正在应用')
    expect(getInitialization(initialization.id)?.status).toBe('applying')
    expect(fetchPlaylistSongs).not.toHaveBeenCalled()
  })

  it('finalizes the analysis run when a reviewed plan is explicitly skipped', async () => {
    const { analyzeSourceInitialization, skipSourceInitialization } = await import('./service')
    const { getInitialization } = await import('./store')
    const analyzed = await analyzeSourceInitialization('source-1', 'user')

    skipSourceInitialization('source-1')

    expect(getInitialization(analyzed.initializationId)?.status).toBe('skipped')
    expect(getRun(analyzed.runId)).toMatchObject({ status: 'cancelled', summary: '用户已明确跳过首次媒体接管' })
    expect(getDb().prepare('SELECT COUNT(*) count FROM download_tasks').get()).toEqual({ count: 0 })
    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
  })

  it('returns to review without writes when the NetEase snapshot drifts before commit', async () => {
    const { commitSourceInitialization, analyzeSourceInitialization } = await import('./service')
    const { getInitialization, setInitializationDecisions } = await import('./store')
    const analyzed = await analyzeSourceInitialization('source-1', 'user')
    setInitializationDecisions({ initializationId: analyzed.initializationId, tier: 'high_confidence', decision: 'adopt' })
    fetchPlaylistSongs.mockResolvedValueOnce({
      name: 'Changed source',
      trackIds: [{ id: 43 }],
      songs: [],
    })

    await expect(commitSourceInitialization(analyzed.initializationId))
      .rejects.toThrow('网易云歌单已变化')

    expect(getInitialization(analyzed.initializationId)).toMatchObject({ status: 'awaiting_review' })
    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_media_decisions').get()).toEqual({ count: 0 })
  })

  it('completes a disabled source without requesting follow-up sync or downloads', async () => {
    const { commitSourceInitialization, analyzeSourceInitialization } = await import('./service')
    const { getInitialization, setInitializationDecisions } = await import('./store')
    const analyzed = await analyzeSourceInitialization('source-1', 'user')
    setInitializationDecisions({ initializationId: analyzed.initializationId, tier: 'high_confidence', decision: 'adopt' })

    const result = await commitSourceInitialization(analyzed.initializationId)

    expect(result).toMatchObject({ applied: 1, downloads: 0, conflicts: 0, shouldSync: false })
    expect(getInitialization(analyzed.initializationId)?.status).toBe('completed')
    expect(getRun(analyzed.runId)?.status).toBe('success')
    expect(getDb().prepare('SELECT COUNT(*) count FROM download_tasks').get()).toEqual({ count: 0 })
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_initialization_items WHERE initialization_id = ?').get(analyzed.initializationId)).toEqual({ count: 0 })
  })

  it('isolates a moved Plex candidate as a conflict instead of adopting it', async () => {
    const { commitSourceInitialization, analyzeSourceInitialization } = await import('./service')
    const { getActiveMediaDecisions, setInitializationDecisions } = await import('./store')
    const analyzed = await analyzeSourceInitialization('source-1', 'user')
    setInitializationDecisions({ initializationId: analyzed.initializationId, tier: 'high_confidence', decision: 'adopt' })
    getSectionTracks.mockResolvedValueOnce([{
      ratingKey: '100',
      title: 'Signal',
      grandparentTitle: 'Alpha',
      parentTitle: 'Night Drive',
      index: 1,
      duration: 180_000,
      Media: [{ Part: [{ file: '/music/moved/Signal.flac' }] }],
    }])

    const result = await commitSourceInitialization(analyzed.initializationId)

    expect(result).toMatchObject({ applied: 0, conflicts: 1, shouldSync: false })
    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
    expect(getActiveMediaDecisions('source-1')).toEqual(new Map([[42, 'defer']]))
  })

  it('applies a shared Plex candidate to at most one NetEase song', async () => {
    const sharedSnapshot = {
      name: 'Shared candidate source',
      trackIds: [{ id: 42 }, { id: 43 }],
      songs: [42, 43].map(id => ({
        id,
        name: 'Signal',
        no: 1,
        dt: 180_000,
        disc: '1',
        artists: [{ name: 'Alpha' }],
        album: { id: 1, name: 'Night Drive', picUrl: '', publishTime: 0 },
      })),
    }
    fetchPlaylistSongs.mockResolvedValueOnce(sharedSnapshot).mockResolvedValueOnce(sharedSnapshot)
    const { commitSourceInitialization, analyzeSourceInitialization } = await import('./service')
    const { getActiveMediaDecisions, setInitializationDecisions } = await import('./store')
    const analyzed = await analyzeSourceInitialization('source-1', 'user')
    setInitializationDecisions({ initializationId: analyzed.initializationId, tier: 'high_confidence', decision: 'adopt' })

    const result = await commitSourceInitialization(analyzed.initializationId)

    expect(result).toMatchObject({ applied: 1, conflicts: 1 })
    expect(getDb().prepare('SELECT netease_song_id FROM song_identity_bindings').all()).toEqual([{ netease_song_id: 42 }])
    expect(getActiveMediaDecisions('source-1')).toEqual(new Map([[43, 'defer']]))
  })
})
