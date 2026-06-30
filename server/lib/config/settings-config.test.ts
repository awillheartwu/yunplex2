import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, readRawConfigFromDb, writeConfigToDb } from '../db'
import { listActivityEvents } from '../activity/store'
import { clearSyncWorker, setSyncWorker } from '../sync/instance'
import { DEFAULT_CONFIG } from './defaults'
import { applyConfigUpdate } from './apply'
import { resolveConnectionTestConfig } from './connection-test'
import { readConfig, writeConfig } from './store'

const tempDirs: string[] = []

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-config-'))
  tempDirs.push(dir)
  return dir
}

function setupDb() {
  initDb(createTempDataDir())
}

describe('settings config validation and migration', () => {
  afterEach(() => {
    clearSyncWorker()
    vi.restoreAllMocks()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects unknown config keys on new writes', () => {
    setupDb()

    expect(() => writeConfig({ sync: { intervalMinutes: 30, ghostFlag: true } })).toThrow('同步包含未知配置项：ghostFlag')
    expect(() => writeConfig({ unknown: {} })).toThrow('配置包含未知配置项：unknown')
  })

  it('rejects invalid enums, out-of-range numbers, empty paths, and unsafe path formats', () => {
    setupDb()

    expect(() => writeConfig({ netease: { quality: 'ultra' } })).toThrow('音质偏好不是有效选项')
    expect(() => writeConfig({ sync: { downloadConcurrency: 99 } })).toThrow('下载并发数必须在 1-10 之间')
    expect(() => writeConfig({ download: { dir: '   ' } })).toThrow('下载目录不能为空')
    expect(() => writeConfig({ other: { pathFormat: '{artist}/{album}' } })).toThrow('存储路径格式必须包含 {title} 或 {track} 变量')
  })

  it('migrates existing dirty database config once, then writes back a legal full config', () => {
    setupDb()

    writeConfigToDb({
      sync: {
        enabled: 'true',
        intervalMinutes: 9999,
        downloadConcurrency: '4',
      },
      other: {
        pathFormat: '',
        fontScale: 3,
        artistAliases: { A: 'B', Broken: 123 },
      },
      unexpected: 'drop me',
    } as any)

    const migrated = readConfig()

    expect(migrated.sync.enabled).toBe(true)
    expect(migrated.sync.intervalMinutes).toBe(1440)
    expect(migrated.sync.downloadConcurrency).toBe(4)
    expect(migrated.other.pathFormat).toBe(DEFAULT_CONFIG.other.pathFormat)
    expect(migrated.other.fontScale).toBe(1.5)
    expect(migrated.other.artistAliases).toEqual({ A: 'B' })
    expect(readRawConfigFromDb()).toEqual(migrated)
  })

  it('applies config updates through worker hot reload and activity recording', () => {
    setupDb()
    const update = vi.fn()
    setSyncWorker({
      schedule: vi.fn(),
      stop: vi.fn(),
      update,
      isScheduled: vi.fn(() => false),
    } as any)

    const { updated, changedKeys } = applyConfigUpdate(
      { sync: { enabled: true, intervalMinutes: 45 } },
      {
        title: '导入系统配置',
        type: 'config_imported',
        summaryWhenChanged: (keys) => `本次导入更新了 ${keys.join('、')}`,
        summaryWhenUnchanged: '导入内容与当前配置一致，运行中的调度器已重新检查。',
        groupKey: 'config:import',
      },
    )

    expect(updated.sync.enabled).toBe(true)
    expect(updated.sync.intervalMinutes).toBe(45)
    expect(changedKeys).toEqual(['sync'])
    expect(update).toHaveBeenCalledTimes(1)

    const events = listActivityEvents({ limit: 10 }).items
    expect(events[0]?.type).toBe('config_imported')
    expect(events[0]?.summary).toBe('本次导入更新了 sync')
  })

  it('resolves connection tests from candidate form config instead of saved config', () => {
    setupDb()
    writeConfig({
      netease: { cookie: 'saved-cookie' },
      plex: { server: 'saved-plex', token: 'saved-token' },
    })

    const candidate = resolveConnectionTestConfig({
      netease: { cookie: 'candidate-cookie' },
      plex: { server: 'candidate-plex', token: 'candidate-token' },
    })

    expect(candidate.netease.cookie).toBe('candidate-cookie')
    expect(candidate.plex.server).toBe('candidate-plex')
    expect(readConfig().netease.cookie).toBe('saved-cookie')
    expect(readConfig().plex.server).toBe('saved-plex')
  })
})
