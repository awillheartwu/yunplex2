import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb } from '../db'
import { writeConfig } from '../config/store'
import { cleanupOldActivityEvents, listActivityEvents, recordActivityEvent } from './store'

const tempDirs: string[] = []

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-activity-'))
  tempDirs.push(dir)
  return dir
}

describe('activity retention', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cleans expired activity events when new events are recorded', () => {
    initDb(createTempDataDir())
    writeConfig({ sync: { activityRetentionDays: 7 } })

    recordActivityEvent({
      domain: 'sync',
      type: 'old_sync_event',
      severity: 'info',
      occurredAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      title: '旧活动',
      summary: '应被自动清理',
    })

    recordActivityEvent({
      domain: 'sync',
      type: 'new_sync_event',
      severity: 'success',
      title: '新活动',
      summary: '应被保留',
    })

    const { items, total } = listActivityEvents({ limit: 10 })
    expect(total).toBe(1)
    expect(items.map(item => item.type)).toEqual(['new_sync_event'])
  })

  it('supports manual cleanup by retention window', () => {
    initDb(createTempDataDir())

    recordActivityEvent({
      domain: 'user',
      type: 'old_user_event',
      severity: 'info',
      occurredAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      title: '旧用户操作',
      summary: '等待清理',
    })

    recordActivityEvent({
      domain: 'user',
      type: 'fresh_user_event',
      severity: 'info',
      occurredAt: new Date(Date.now() - 1 * 86400000).toISOString(),
      title: '新用户操作',
      summary: '应该保留',
    })

    expect(cleanupOldActivityEvents(3)).toBe(1)
    expect(listActivityEvents({ limit: 10 }).items.map(item => item.type)).toEqual(['fresh_user_event'])
  })

  it('filters activity events by domain, severity, query, and offset', () => {
    initDb(createTempDataDir())
    const now = Date.now()

    recordActivityEvent({
      domain: 'sync',
      type: 'sync_run_completed',
      severity: 'success',
      occurredAt: new Date(now - 2 * 60_000).toISOString(),
      title: '同步源“华语摇滚”完成',
      summary: '成功 12 首',
    })
    recordActivityEvent({
      domain: 'download',
      type: 'download_failed',
      severity: 'error',
      occurredAt: new Date(now - 60_000).toISOString(),
      title: '下载失败',
      summary: '耳鬼出风 下载失败',
    })
    recordActivityEvent({
      domain: 'sync',
      type: 'source_sync_warning',
      severity: 'warning',
      occurredAt: new Date(now).toISOString(),
      title: '同步源“日语精选”需要关注',
      summary: '版权受限 1 首',
    })

    const filtered = listActivityEvents({
      domains: ['sync'],
      severities: ['warning'],
      query: '日语',
      limit: 10,
    })
    expect(filtered.total).toBe(1)
    expect(filtered.items[0]?.type).toBe('source_sync_warning')

    const paged = listActivityEvents({ limit: 1, offset: 1 })
    expect(paged.total).toBe(3)
    expect(paged.items.map(item => item.type)).toEqual(['download_failed'])
  })
})
