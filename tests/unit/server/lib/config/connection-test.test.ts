import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb } from '~~/server/lib/db'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { DOWNLOAD_WRITE_PROBE_PREFIX, testDownloadPathConfig } from '~~/server/lib/config/connection-test'
import { ConnectionTestError } from '~~/server/lib/config/connection-test-error'
import { CONNECTION_TEST_TIMEOUT_MS, runConnectionTest } from '~~/server/lib/config/connection-test-runner'

const mocks = vi.hoisted(() => ({
  checkCookie: vi.fn(),
  initPlexClient: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  statfsSync: vi.fn(),
}))

vi.mock('~~/server/lib/netease', () => ({ checkCookie: mocks.checkCookie }))
vi.mock('~~/server/lib/plex-client', () => ({ createPlexClient: vi.fn(), initPlexClient: mocks.initPlexClient }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    writeFileSync: mocks.writeFileSync,
    rmSync: mocks.rmSync,
    statfsSync: mocks.statfsSync,
  }
})

const scratchDirs: string[] = []
let dataDir = ''

function scratchDir(prefix = 'reyunplex-connection-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratchDirs.push(dir)
  return dir
}

function downloadConfig(dir: string) {
  return { ...DEFAULT_CONFIG, download: { ...DEFAULT_CONFIG.download, dir } }
}

beforeEach(async () => {
  dataDir = scratchDir('reyunplex-connection-db-')
  initDb(dataDir)
  const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
  mocks.checkCookie.mockReset()
  mocks.initPlexClient.mockReset()
  mocks.writeFileSync.mockReset().mockImplementation(actualFs.writeFileSync)
  mocks.rmSync.mockReset().mockImplementation(actualFs.rmSync)
  mocks.statfsSync.mockReset().mockImplementation(actualFs.statfsSync)
})

afterEach(() => {
  vi.useRealTimers()
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('connection test bounded wait', () => {
  it('stops waiting after 15 seconds and keeps the network finding', async () => {
    vi.useFakeTimers()
    mocks.checkCookie.mockImplementation(() => new Promise(() => {}))

    const pending = runConnectionTest('netease', { netease: { cookie: 'test-cookie' } }).catch(error => error)
    await vi.advanceTimersByTimeAsync(CONNECTION_TEST_TIMEOUT_MS)

    const failure = await pending
    expect(failure).toBeInstanceOf(ConnectionTestError)
    expect(failure.code).toBe('netease_unavailable')
    expect(failure.message).toContain('超过 15 秒')
  })

  it('clears the deadline timer when the check answers first', async () => {
    vi.useFakeTimers()
    mocks.checkCookie.mockResolvedValueOnce({ valid: true, profile: { userId: 1, nickname: 'Tester' } })

    await runConnectionTest('netease', { netease: { cookie: 'test-cookie' } })

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('connection test failure classification', () => {
  it('separates a NetEase network failure from an invalid cookie', async () => {
    mocks.checkCookie.mockResolvedValueOnce({ valid: false, networkError: true })
    const failure = await runConnectionTest('netease', { netease: { cookie: 'test-cookie' } }).catch(error => error)

    expect(failure).toBeInstanceOf(ConnectionTestError)
    expect(failure.code).toBe('netease_unavailable')
    expect(failure.message).toContain('网络异常')
  })

  it('keeps an invalid cookie as an authentication failure', async () => {
    mocks.checkCookie.mockResolvedValueOnce({ valid: false })
    const failure = await runConnectionTest('netease', { netease: { cookie: 'test-cookie' } }).catch(error => error)

    expect(failure.code).toBe('authentication_failed')
    expect(failure.message).toContain('Cookie 已失效')
  })

  it('returns the connected account on success', async () => {
    mocks.checkCookie.mockResolvedValueOnce({ valid: true, profile: { userId: 7, nickname: 'Tester' } })
    const result = await runConnectionTest('netease', { netease: { cookie: 'test-cookie' } })

    expect(result.message).toContain('Tester')
    expect(result.data).toMatchObject({ success: true, nickname: 'Tester', userId: 7 })
  })

  it('reports Plex context without echoing the configured token', async () => {
    const token = 'super-secret-plex-token'
    const candidate = { plex: { server: '192.168.1.50', port: 32400, token, section: '音乐' } }

    mocks.initPlexClient.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED 192.168.1.50:32400'), { code: 'ECONNREFUSED' }))
    const refused = await runConnectionTest('plex', candidate).catch(error => error)
    expect(refused.code).toBe('plex_unavailable')
    expect(refused.message).toContain('192.168.1.50:32400')
    expect(refused.message).not.toContain(token)

    mocks.initPlexClient.mockRejectedValueOnce(new Error('Plex Server denied request, you must provide a way to authenticate!'))
    const unauthorized = await runConnectionTest('plex', candidate).catch(error => error)
    expect(unauthorized.message).toContain('Token 无效')
    expect(unauthorized.message).not.toContain(token)
  })

  it('redacts credential-shaped text that was typed into the Plex server field', async () => {
    mocks.initPlexClient.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    const failure = await runConnectionTest('plex', {
      plex: { server: '192.168.1.50?token=leaked-plex-token', port: 32400, token: 'real-token', section: '音乐' },
    }).catch(error => error)

    expect(failure.message).toContain('192.168.1.50')
    expect(failure.message).not.toContain('leaked-plex-token')
    expect(failure.message).not.toContain('real-token')
  })
})

describe('download directory validation', () => {
  it('writes one unique probe file and removes it again', () => {
    const dir = scratchDir('reyunplex-download-probe-')
    const result = testDownloadPathConfig(downloadConfig(dir))

    expect(result).toMatchObject({ success: true, writable: true, downloadDir: dir })
    const writePaths = (mocks.writeFileSync.mock.calls as Array<[string]>).map(([path]) => String(path))
    expect(writePaths).toHaveLength(1)
    const writtenPath = writePaths[0]!
    expect(writtenPath.startsWith(join(dir, DOWNLOAD_WRITE_PROBE_PREFIX))).toBe(true)
    expect(writtenPath.endsWith('.tmp')).toBe(true)
    const removedPaths = (mocks.rmSync.mock.calls as Array<[string]>).map(([path]) => String(path))
    expect(removedPaths).toContain(writtenPath)
    expect(readdirSync(dir)).toEqual([])
  })

  it('distinguishes a missing path, a non-directory and an unwritable directory', () => {
    const missing = join(tmpdir(), `reyunplex-missing-${Date.now()}`)
    try { testDownloadPathConfig(downloadConfig(missing)) } catch (error) {
      expect(error).toBeInstanceOf(ConnectionTestError)
      expect((error as ConnectionTestError).code).toBe('validation_failed')
      expect((error as ConnectionTestError).message).toContain('下载目录不存在')
    }

    const fileDir = scratchDir('reyunplex-download-file-')
    const filePath = join(fileDir, 'not-a-directory.txt')
    writeFileSync(filePath, 'x')
    expect(() => testDownloadPathConfig(downloadConfig(filePath))).toThrow('下载目录不是有效文件夹')

    const blockedDir = scratchDir('reyunplex-download-blocked-')
    mocks.writeFileSync.mockImplementationOnce(() => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) })
    expect(() => testDownloadPathConfig(downloadConfig(blockedDir))).toThrow('下载目录不可写')
    expect(readdirSync(blockedDir)).toEqual([])
  })

  it('fails when statfs reports zero available blocks', () => {
    const dir = scratchDir('reyunplex-download-full-')
    mocks.statfsSync.mockReturnValueOnce({ bavail: 0 })

    try {
      testDownloadPathConfig(downloadConfig(dir))
      expect.unreachable('expected the zero-space check to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionTestError)
      expect((error as ConnectionTestError).code).toBe('filesystem_failed')
      expect((error as ConnectionTestError).message).toContain('无可用空间')
    }
    expect(mocks.writeFileSync).not.toHaveBeenCalled()
  })

  it('maps a probe ENOSPC to the out-of-space finding', () => {
    const dir = scratchDir('reyunplex-download-enospc-')
    mocks.writeFileSync.mockImplementationOnce(() => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }) })

    expect(() => testDownloadPathConfig(downloadConfig(dir))).toThrow('无可用空间')
    expect(readdirSync(dir)).toEqual([])
  })
})
