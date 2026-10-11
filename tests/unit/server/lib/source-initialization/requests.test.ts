import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb, readConfigFromDb } from '~~/server/lib/db'
import { getSource, updateSource } from '~~/server/lib/playlist/store'
import { getRun, saveRun } from '~~/server/lib/run/store'
import { analyzeSourceInitialization, commitSourceInitialization, skipSourceInitialization } from '~~/server/lib/source-initialization/service'
import { requestSourceInitialization, restartSourceInitialization } from '~~/server/lib/source-initialization/requests'
import { getInitialization, setInitializationDecisions, setInitializationStatus } from '~~/server/lib/source-initialization/store'
import { resolveInitializationGate } from '~~/server/lib/source-initialization/gate'
import { cancelSourceRequests } from '~~/server/lib/sync/source-request-cancellation'
import { initializationFailure, InitializationConflictError } from '~~/server/lib/source-initialization/errors'
import { requestSources } from '~~/server/lib/sync/source-requests'
import { startWorker, stopWorker } from '~~/server/lib/sync/worker'
import { recoverInterruptedSourceRequests } from '~~/server/lib/sync/source-schedule-store'

const remote = vi.hoisted(() => ({ tracks: vi.fn(), playlist: vi.fn() }))
vi.mock('~~/server/lib/netease', () => ({ fetchPlaylistSongs: remote.playlist }))
vi.mock('~~/server/lib/plex-client', () => ({ initPlexClient: vi.fn(), getSectionKey: vi.fn(async () => '1'), getSectionTracks: remote.tracks }))
let directory = ''
function insertSource(id: string, enabled = false) {
  const now = new Date().toISOString()
  getDb().prepare(`INSERT INTO playlist_sources (id,netease_playlist_id,name,enabled,netease_playlist_name,created_at,updated_at)
    VALUES (?,?,?,?,?, ?,?)`).run(id,(getDb().prepare('SELECT COUNT(*) count FROM playlist_sources').get() as { count: number }).count + 1,id,Number(enabled),id,now,now)
}
const song = { id: 42, name: 'Signal', no: 1, dt: 180000, disc: '1', artists: [{ name: 'Alpha' }], album: { id: 1, name: 'Night', picUrl: '', publishTime: 0 } }
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-requests-test-'))
  initDb(directory)
  insertSource('source-1')
  remote.playlist.mockReset()
  remote.tracks.mockReset()
  remote.playlist.mockResolvedValue({ name: 'Source', trackIds: [{ id: 42 }], songs: [song] })
  remote.tracks.mockResolvedValue([{ ratingKey: '100', title: 'Signal', grandparentTitle: 'Alpha', parentTitle: 'Night', index: 1, duration: 180000, Media: [{ Part: [{ file: '/music/Signal.flac' }] }] }])
})
afterEach(async () => { await stopWorker(); closeDb(); rmSync(directory, { recursive: true, force: true }); vi.clearAllMocks(); vi.unstubAllGlobals() })
async function reviewed() {
  const result = await analyzeSourceInitialization('source-1')
  setInitializationDecisions({ initializationId: result.initializationId, songIds: [42], decision: 'adopt' })
  return result
}
function config() { const value = readConfigFromDb(); value.sync.enabled = false; return value }
function service() {
  return { getState: () => ({ isRunning: false }), prepareSyncForSource: vi.fn((id: string) => ({ runId: `sync-${id}`, run: async () => ({ lastSyncResult: 'success', failures: [] }) })), cancelSync: () => true }
}

describe('durable source operations', () => {
  it('restarts atomically, keeps the gate shut, and rejects a stale page', async () => {
    const old = await reviewed()
    const next = restartSourceInitialization('source-1', old.initializationId)
    expect(next.initializationId).not.toBe(old.initializationId)
    expect(getInitialization(old.initializationId)?.status).toBe('cancelled')
    expect(getRun(old.runId)?.status).toBe('cancelled')
    expect(resolveInitializationGate(getSource('source-1')!, config()).action).toBe('awaiting_review')
    expect(() => restartSourceInitialization('source-1', old.initializationId)).toThrow('已变化')
    expect(restartSourceInitialization('source-1', next.initializationId)).toEqual(next)
    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
  })
  it('rolls restart back when persistence of the new request fails', async () => {
    const old = await reviewed()
    getDb().exec("CREATE TRIGGER reject_request BEFORE INSERT ON source_sync_queue BEGIN SELECT RAISE(ABORT,'request rejected'); END")
    expect(() => restartSourceInitialization('source-1', old.initializationId)).toThrow('request rejected')
    expect(getInitialization(old.initializationId)?.status).toBe('awaiting_review')
    expect(getRun(old.runId)?.status).toBe('awaiting_action')
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_initializations').get()).toEqual({ count: 1 })
  })
  it('rolls bindings and completion back if follow-up enqueue fails', async () => {
    const old = await reviewed()
    updateSource('source-1', { enabled: true })
    getDb().exec("CREATE TRIGGER reject_follow_up BEFORE INSERT ON source_sync_queue WHEN NEW.follow_up_of IS NOT NULL BEGIN SELECT RAISE(ABORT,'follow-up rejected'); END")
    await expect(commitSourceInitialization(old.initializationId)).rejects.toThrow('follow-up rejected')
    expect(getInitialization(old.initializationId)?.status).toBe('awaiting_review')
    expect(getRun(old.runId)?.status).toBe('awaiting_action')
    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
  })
  it('commits once, returns the durable follow-up on retry, and resumes without a wake', async () => {
    const old = await reviewed()
    updateSource('source-1', { enabled: true })
    const result = await commitSourceInitialization(old.initializationId)
    remote.tracks.mockRejectedValueOnce(new Error('must not re-fetch'))
    expect(await commitSourceInitialization(old.initializationId)).toEqual(result)
    expect(result.followUpRequestId).toBeTruthy()
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_sync_queue').get()).toEqual({ count: 1 })
    const sync = service()
    const originalRun = getRun(old.runId)!
    saveRun({ ...originalRun, id: 'sync-source-1', type: 'sync', status: 'running' })
    const worker = startWorker(config, sync as never, directory)
    await worker.runOnce()
    expect(sync.prepareSyncForSource).toHaveBeenCalledOnce()
    expect(getInitialization(old.initializationId)?.followUpRunId).toBe('sync-source-1')
    expect(getDb().prepare('SELECT COUNT(*) count FROM task_run_links').get()).toEqual({ count: 2 })
  })
  it('checks enabled state after external validation and before committing', async () => {
    const old = await reviewed()
    updateSource('source-1', { enabled: true })
    remote.tracks.mockImplementationOnce(async () => { updateSource('source-1', { enabled: false }); return [] })
    expect(await commitSourceInitialization(old.initializationId)).toMatchObject({ shouldSync: false, followUpRequestId: null })
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_sync_queue').get()).toEqual({ count: 0 })
  })
  it('does not reset the active commit when a concurrent commit is rejected', async () => {
    const old = await reviewed()
    let release!: (value: unknown[]) => void
    remote.tracks.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const committing = commitSourceInitialization(old.initializationId)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await expect(commitSourceInitialization(old.initializationId)).rejects.toThrow('正在应用')
    expect(getInitialization(old.initializationId)?.status).toBe('applying')
    release([])
    await committing
  })
  it('keeps incompatible drafts readable but refuses writes', async () => {
    const old = await reviewed()
    getDb().prepare('UPDATE source_initializations SET rule_version=0 WHERE id=?').run(old.initializationId)
    expect(getInitialization(old.initializationId)?.rulesCompatible).toBe(false)
    await expect(commitSourceInitialization(old.initializationId)).rejects.toThrow('规则已更新')
    expect(() => setInitializationDecisions({ initializationId: old.initializationId, songIds: [42], decision: 'download' })).toThrow('规则已更新')
    expect(restartSourceInitialization('source-1', old.initializationId).requestId).toBeTruthy()
  })

  it('rejects stale HTTP draft edits and commits with an actionable conflict envelope', async () => {
    const old = await reviewed()
    const next = restartSourceInitialization('source-1', old.initializationId)
    await analyzeSourceInitialization('source-1', 'user', next.initializationId)
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRouterParam', () => 'source-1')
    vi.stubGlobal('readBody', async () => ({ initializationId: old.initializationId, songIds: [42], decision: 'download' }))
    const edits = (await import('~~/server/api/playlist-sources/[id]/initialization/decisions.put')).default
    const commits = (await import('~~/server/api/playlist-sources/[id]/initialization/commit.post')).default
    for (const handler of [edits, commits]) {
      expect(await handler({} as never)).toMatchObject({ code: 409, msg: expect.stringContaining('请刷新') })
    }
    expect(getInitialization(next.initializationId)?.status).toBe('awaiting_review')
    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
  })
  it('accepts a mixed batch atomically with ready sources first and review sources waiting', async () => {
    const review = await reviewed()
    insertSource('ready'); updateSource('ready', { initializeMediaOnFirstSync: false })
    insertSource('analyze')
    const result = requestSources({ sourceIds: ['analyze','source-1','ready'] }, () => false)
    expect(result.results.map(item => [item.sourceId,item.status])).toEqual([['ready','accepted'],['analyze','accepted'],['source-1','awaiting_review']])
    const order: string[] = []
    const sync = service()
    sync.prepareSyncForSource.mockImplementation(id => { order.push(id); return { runId: 'sync', run: async () => ({ lastSyncResult: 'success', failures: [] }) } })
    remote.tracks.mockImplementation(async () => { order.push('analysis'); return [] })
    const worker = startWorker(config, sync as never, directory)
    await worker.runOnce()
    expect(order).toEqual(['ready','analysis'])
    expect(getInitialization(review.initializationId)?.status).toBe('awaiting_review')
    expect(getDb().prepare("SELECT COUNT(*) count FROM source_sync_queue WHERE status IN ('pending','running')").get()).toEqual({ count: 0 })
  })
  it('rejects busy manual sync without side effects', () => {
    expect(requestSources({ sourceIds: ['source-1'] }, () => true).results[0]?.status).toBe('busy')
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_sync_queue').get()).toEqual({ count: 0 })
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_initializations').get()).toEqual({ count: 0 })
  })
  it('serializes analyses in the source consumer and recovers the same request after restart', async () => {
    insertSource('source-2')
    const first = requestSourceInitialization('source-1')
    const second = requestSourceInitialization('source-2')
    getDb().prepare("UPDATE source_sync_queue SET status='running',lease_owner='old-process' WHERE id=?").run(first.requestId)
    setInitializationStatus(first.initializationId, 'analyzing')
    closeDb(); initDb(directory); recoverInterruptedSourceRequests()
    expect(requestSourceInitialization('source-1')).toEqual(first)
    let active = 0; let max = 0
    remote.tracks.mockImplementation(async () => { active++; max = Math.max(max, active); await Promise.resolve(); active--; return [] })
    const worker = startWorker(config, service() as never, directory)
    await worker.runOnce()
    expect(max).toBe(1)
    expect(getInitialization(first.initializationId)?.status).toBe('awaiting_review')
    expect(getInitialization(second.initializationId)?.status).toBe('awaiting_review')
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_sync_queue').get()).toEqual({ count: 2 })
  })
  it('preserves scheduled analysis intent across schema upgrade and repeated requests', () => {
    updateSource('source-1', { enabled: true })
    const request = requestSourceInitialization('source-1', 'schedule')
    expect(requestSourceInitialization('source-1', 'user')).toEqual(request)
    expect(getInitialization(request.initializationId)?.trigger).toBe('schedule')
    closeDb(); initDb(directory)
    expect(getDb().prepare('SELECT trigger,allow_disabled FROM source_sync_queue WHERE id=?').get(request.requestId))
      .toEqual({ trigger: 'schedule', allow_disabled: 0 })
  })
  it('keeps a failed explicit analysis gated even after its default is disabled', async () => {
    const request = requestSourceInitialization('source-1')
    remote.tracks.mockRejectedValueOnce(new Error('offline'))
    const worker = startWorker(config, service() as never, directory)
    await worker.runOnce()
    updateSource('source-1', { initializeMediaOnFirstSync: false })
    expect(getInitialization(request.initializationId)?.status).toBe('failed')
    expect(resolveInitializationGate(getSource('source-1')!, config()).action).toBe('analyze')
    expect(initializationFailure(new InitializationConflictError('接管方案已变化，请刷新后重新操作')))
      .toMatchObject({ code: 409, msg: '接管方案已变化，请刷新后重新操作' })
  })
  it('cancels a queued analysis when the user explicitly skips it', () => {
    const request = requestSourceInitialization('source-1')
    skipSourceInitialization('source-1')
    expect(getDb().prepare('SELECT status FROM source_sync_queue WHERE id=?').get(request.requestId)).toEqual({ status: 'cancelled' })
    expect(resolveInitializationGate(getSource('source-1')!, config()).action).toBe('sync')
  })
  it('persists allowed modes and rejects invalid mode parameters without creating work', () => {
    updateSource('source-1', { initializeMediaOnFirstSync: false })
    expect(() => requestSources({ sourceIds: ['source-1'], mode: 'invalid' as never }, () => false)).toThrow('无效')
    expect(() => requestSources({ sourceIds: ['source-1'], mode: 'normal', takeOverExternal: true }, () => false)).toThrow('仅重新下载')
    const result = requestSources({ sourceIds: ['source-1'], mode: 'redownload_managed', takeOverExternal: true, trigger: 'retry' }, () => false)
    expect(getDb().prepare('SELECT mode,trigger,take_over_external,allow_disabled FROM source_sync_queue WHERE id=?').get(result.results[0]?.requestId))
      .toEqual({ mode: 'redownload_managed', trigger: 'retry', take_over_external: 1, allow_disabled: 1 })
    expect(requestSources({ sourceIds: ['source-1'] }, () => false).results[0]?.status).toBe('busy')
    expect(getDb().prepare('SELECT COUNT(*) count FROM source_sync_queue').get()).toEqual({ count: 1 })
  })
  it('cancels all pending members of an accepted batch without executing or opening analysis gates', () => {
    insertSource('second')
    requestSources({ sourceIds: ['source-1', 'second'] }, () => false)
    expect(cancelSourceRequests(() => false)).toBe(true)
    expect(getDb().prepare("SELECT COUNT(*) count FROM source_sync_queue WHERE status IN ('pending','running')").get()).toEqual({ count: 0 })
    expect(resolveInitializationGate(getSource('source-1')!, config()).action).toBe('analyze')
    expect(remote.playlist).not.toHaveBeenCalled()
  })
  it('stops an active analysis and resumes its same request without automatically committing', async () => {
    const request = requestSourceInitialization('source-1')
    let release!: (tracks: unknown[]) => void
    remote.tracks.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    startWorker(config, service() as never, directory)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const stopped = stopWorker()
    release([])
    await stopped
    expect(getInitialization(request.initializationId)?.status).toBe('pending')
    expect(getRun(request.runId)?.status).toBe('running')
    expect(getDb().prepare('SELECT status,lease_owner FROM source_sync_queue WHERE id=?').get(request.requestId)).toEqual({ status: 'pending', lease_owner: null })
    const restarted = startWorker(config, service() as never, directory)
    await restarted.runOnce()
    expect(getInitialization(request.initializationId)?.status).toBe('awaiting_review')
    expect(getDb().prepare('SELECT COUNT(*) count FROM song_identity_bindings').get()).toEqual({ count: 0 })
  })

})
