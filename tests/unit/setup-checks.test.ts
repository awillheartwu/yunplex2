import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '../../server/lib/db'
import { writeConfig } from '../../server/lib/config/store'
import { DEFAULT_CONFIG } from '../../server/lib/config/defaults'
import { runRequiredSetupChecks, runSetupCheck } from '../../server/lib/setup/checks'

vi.mock('../../server/lib/netease', () => ({
  checkCookie: vi.fn(async () => ({ valid: true, profile: { nickname: 'Tester', userId: 123 } })),
}))

vi.mock('../../server/lib/plex-client', () => ({
  initPlexClient: vi.fn(async () => 'machine-id'),
}))

let dataDir = ''
let downloadDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'reyunplex-setup-db-'))
  downloadDir = mkdtempSync(join(tmpdir(), 'reyunplex-setup-download-'))
  initDb(dataDir)
  writeConfig({
    netease: { cookie: 'MUSIC_U=test' },
    plex: { server: '127.0.0.1', token: 'plex-token', section: '音乐' },
    download: { dir: downloadDir },
  })
})

afterEach(() => {
  closeDb()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(downloadDir, { recursive: true, force: true })
})

describe('setup checks', () => {
  it('runs each required setup check through the registry', async () => {
    const results = await runRequiredSetupChecks()

    expect(results).toHaveLength(3)
    expect(results.map(result => result.key)).toEqual(['netease', 'plex', 'download'])
    expect(results.every(result => result.ok)).toBe(true)
  })

  it('checks the download directory from candidate config without requiring a saved config update', async () => {
    const candidateDir = mkdtempSync(join(tmpdir(), 'reyunplex-candidate-download-'))
    try {
      const result = await runSetupCheck('download', {
        download: { dir: candidateDir },
      })

      expect(result.ok).toBe(true)
      expect(result.detail?.dir).toBe(candidateDir)
    } finally {
      rmSync(candidateDir, { recursive: true, force: true })
    }
  })

  it('returns a failed netease check when cookie is missing', async () => {
    const result = await runSetupCheck('netease', {
      ...DEFAULT_CONFIG,
      netease: { ...DEFAULT_CONFIG.netease, cookie: '' },
      download: { ...DEFAULT_CONFIG.download, dir: downloadDir },
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('未配置网易云 Cookie')
  })
})
