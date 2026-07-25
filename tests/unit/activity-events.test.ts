import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeDb, initDb } from '../../server/lib/db'
import { listActivityEvents, recordActivityEvent } from '../../server/lib/activity/store'

let tempPath: string | null = null

afterEach(() => {
  vi.useRealTimers()
  closeDb()
  if (tempPath) {
    rmSync(tempPath, { recursive: true, force: true })
    tempPath = null
  }
})

describe('activity event store', () => {
  it('persists events across all four domains with stable fields', () => {
    tempPath = mkdtempSync(join(tmpdir(), 'yunplex-activity-test-'))
    initDb(tempPath)

    recordActivityEvent({
      domain: 'sync',
      type: 'sync_run_completed',
      severity: 'success',
      title: '同步完成',
      summary: '同步 12 首',
      context: { jobId: 'job-1' },
      link: '/task-center?tab=sync-history&id=job-1',
      groupKey: 'job:job-1',
    })
    recordActivityEvent({
      domain: 'download',
      type: 'download_failed',
      severity: 'error',
      title: '下载失败',
      summary: '网络错误',
      context: { taskId: 'task-1' },
      link: '/task-center?tab=failures',
      groupKey: 'download:job-1:source-1',
    })
    recordActivityEvent({
      domain: 'plex',
      type: 'plex_playlist_reordered',
      severity: 'success',
      title: 'Plex 重排完成',
      summary: '顺序已刷新',
      context: { ratingKey: '123' },
      link: '/task-center?tab=activities',
      groupKey: 'job:job-1:source-1',
    })
    recordActivityEvent({
      domain: 'user',
      type: 'source_updated',
      severity: 'info',
      actor: 'user',
      title: '更新同步源',
      summary: '调整了配置',
      context: { sourceId: 'source-1', changedKeys: ['enabled'] },
      link: '/sync-sources',
      groupKey: 'source:source-1',
    })

    const { items, total } = listActivityEvents({ limit: 10 })

    expect(total).toBe(4)
    expect(items.map((item) => item.domain).sort()).toEqual(['download', 'plex', 'sync', 'user'])
    expect(items[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      title: expect.any(String),
      summary: expect.any(String),
      severity: expect.stringMatching(/info|success|warning|error/),
      context: expect.any(Object),
    }))
  })

  it('filters activity events by local date range inclusively', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-26T00:00:00.000Z'))

    tempPath = mkdtempSync(join(tmpdir(), 'yunplex-activity-date-test-'))
    initDb(tempPath)

    recordActivityEvent({
      domain: 'sync',
      type: 'old_sync',
      severity: 'success',
      title: '旧同步',
      summary: '不在范围内',
      occurredAt: '2026-06-08T23:59:59.000Z',
    })
    recordActivityEvent({
      domain: 'sync',
      type: 'morning_sync',
      severity: 'success',
      title: '早间同步',
      summary: '范围开始',
      occurredAt: '2026-06-09T00:00:00.000Z',
    })
    recordActivityEvent({
      domain: 'download',
      type: 'evening_download',
      severity: 'info',
      title: '晚间下载',
      summary: '范围结束当天',
      occurredAt: '2026-06-25T23:59:59.000Z',
    })
    recordActivityEvent({
      domain: 'plex',
      type: 'new_plex',
      severity: 'warning',
      title: '新 Plex 事件',
      summary: '不在范围内',
      occurredAt: '2026-06-26T00:00:00.000Z',
    })

    const { items, total } = listActivityEvents({
      limit: 10,
      from: '2026-06-09',
      to: '2026-06-25',
      timeZone: 'UTC',
    })

    expect(total).toBe(2)
    expect(items.map(item => item.type)).toEqual(['evening_download', 'morning_sync'])
  })
})
