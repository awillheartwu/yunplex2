import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { createManualDownloadRun, saveRun } from '~~/server/lib/run/store'
import { getActivitySnapshot } from '~~/server/lib/run/activity'
import { getQueueStatus } from '~~/server/lib/download/queue'
import { linkRunFileTask } from '~~/server/lib/db/file-task-schema'
import type { SyncState } from '~~/server/lib/log/types'
import { activityPhases, activityPlanLink, activityStage, activityState } from '~~/lib/activity-presentation'

let directory = ''
const idle: SyncState = { isRunning: false, currentStage: 'idle', startedAt: null, currentSourceName: null, lastSyncAt: null, lastSyncResult: null, syncCount: 0, successCount: 0, failureCount: 0, currentSong: null, progress: null, failures: [], dryRun: false }
function setup() { directory = mkdtempSync(join(tmpdir(), 'activity-snapshot-')); initDb(directory) }
function run(id: string) { return createManualDownloadRun({ id, total: 2, sourceLabel: id }) }
function task(id: string, owner: string, status: string) {
  getDb().prepare(`INSERT INTO download_tasks(id, song_id, song_name, status, run_id, job_id, created_at, updated_at)
    VALUES(?, 1, ?, ?, ?, ?, ?, ?)`).run(id, id, status, owner, owner, new Date().toISOString(), new Date().toISOString())
}
afterEach(() => { closeDb(); if (directory) rmSync(directory, { recursive: true, force: true }); directory = '' })

describe('activity snapshot and presentation', () => {
  it('keeps awaiting initialization out of the file workflow even with historical downloads', () => {
    setup()
    saveRun({ ...run('plan'), type: 'source_initialization', status: 'awaiting_action', sourceIds: ['source-one'], durationMs: 11000 })
    task('historical', 'older-run', 'done')
    const snapshot = getActivitySnapshot(idle)
    expect(snapshot.running).toEqual([])
    expect(snapshot.waiting).toHaveLength(1)
    const item = snapshot.waiting[0]!
    expect(item.files).toBeNull()
    expect(item.live).toBeNull()
    expect(activityState(item)).toBe('waiting')
    expect(activityStage(item)).toContain('等待你确认')
    expect(activityPhases(item)).toEqual([])
    expect(activityPlanLink(item)).toBe('/sync-sources/source-one?tab=initialization')
  })
  it('counts shared file tasks once per associated run and never mixes in other runs', () => {
    setup()
    run('first'); run('second'); run('history')
    task('shared', 'first', 'downloading'); task('completed', 'first', 'done'); task('unrelated', 'history', 'done')
    linkRunFileTask(getDb(), { runId: 'first', taskId: 'shared', sourceId: null })
    linkRunFileTask(getDb(), { runId: 'second', taskId: 'shared', sourceId: null })
    const snapshot = getActivitySnapshot(idle)
    const first = snapshot.running.find(item => item.id === 'first')!
    const second = snapshot.running.find(item => item.id === 'second')!
    expect(first.files?.counts).toEqual({ downloading: 1, tagging: 0, pending: 0, done: 1, failed: 0, total: 2 })
    expect(second.files?.counts.done).toBe(0)
    expect(second.files?.items.map(item => item.id)).toEqual(['shared'])
    expect(first.files?.items.map(item => item.id)).toEqual(['shared'])
    expect(getQueueStatus().done).toBe(2)
  })
  it('binds live Plex progress only to its exact run and does not claim completion for manual files', () => {
    setup()
    saveRun({ ...run('sync'), type: 'sync' }); run('manual')
    task('file', 'manual', 'done')
    const snapshot = getActivitySnapshot({ ...idle, isRunning: true, currentRunId: 'sync', currentStage: 'refreshing_plex' })
    const sync = snapshot.running.find(item => item.id === 'sync')!
    const manual = snapshot.running.find(item => item.id === 'manual')!
    expect(activityStage(sync)).toBe('等待 Plex 识别')
    expect(activityPhases(sync).filter(item => item.current).map(item => item.label)).toEqual(['Plex 更新'])
    expect(manual.live).toBeNull()
    expect(activityStage(manual)).toBe('文件处理已完成，等待运行结果')
    expect(activityPhases(manual)).toEqual([])
    expect(snapshot.unlistedLive).toBeNull()
    expect(getActivitySnapshot({ ...idle, isRunning: true, currentRunId: 'unknown', dryRun: true }).unlistedLive?.dryRun).toBe(true)
  })
  it('never gives running analysis or queued requests a download stage', () => {
    setup()
    saveRun({ ...run('analysis'), type: 'source_initialization' })
    const item = getActivitySnapshot(idle).running[0]!
    expect(item.files).toBeNull()
    expect(activityStage(item)).toContain('正在分析媒体关联')
    expect(activityPhases(item)).toEqual([])
    const queued = { ...item, sourceRequestStatus: 'pending' as const }
    expect(activityState(queued)).toBe('queued')
    expect(activityStage(queued)).toContain('等待执行')
  })
  it('reports only active rows, with an explicit total when more than six files are queued', () => {
    setup(); run('batch')
    for (let i = 0; i < 9; i++) task(`pending-${i}`, 'batch', 'pending')
    task('downloading', 'batch', 'downloading')
    task('done', 'batch', 'done')
    const files = getActivitySnapshot(idle).running[0]!.files!
    expect(files.total).toBe(10)
    expect(files.items).toHaveLength(6)
    expect(files.items[0]!.status).toBe('downloading')
    expect(files.items.some(item => item.status === 'done')).toBe(false)
  })
})
