import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../config/types'
import { DEFAULT_CONFIG } from '../config/defaults'
import { seedConfig } from './config-seed'

const CONFIG_ENV_KEYS = [
  'YUNPLEX2_CONFIG',
  'YUNPLEX2_NETEASE_COOKIE',
  'YUNPLEX2_NETEASE_QUALITY',
  'YUNPLEX2_PLEX_SERVER',
  'YUNPLEX2_PLEX_PORT',
  'YUNPLEX2_PLEX_TOKEN',
  'YUNPLEX2_PLEX_SECTION',
  'YUNPLEX2_DOWNLOAD_DIR',
  'YUNPLEX2_PLEX_LIBRARY_PATH_PREFIX',
  'YUNPLEX2_SYNC_INTERVAL',
  'YUNPLEX2_SYNC_LIMIT',
  'YUNPLEX2_SYNC_ENABLED',
] as const
const originalEnvironment = Object.fromEntries(
  CONFIG_ENV_KEYS.map(key => [key, process.env[key]]),
) as Record<(typeof CONFIG_ENV_KEYS)[number], string | undefined>

describe('config seed', () => {
  beforeEach(() => {
    for (const key of CONFIG_ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    for (const key of CONFIG_ENV_KEYS) {
      const value = originalEnvironment[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    vi.restoreAllMocks()
  })

  it('deep-merges a partial environment config while preserving defaults', () => {
    const database = new Database(':memory:')
    database.exec('CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    process.env.YUNPLEX2_CONFIG = JSON.stringify({
      sync: { enabled: true },
      other: { artistAliases: { '旧名': '新名' } },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      seedConfig(database, '/unused')

      const row = database.prepare('SELECT value FROM config WHERE key = ?').get('app') as { value: string }
      const seeded = JSON.parse(row.value) as AppConfig
      expect(seeded.sync).toEqual({ ...DEFAULT_CONFIG.sync, enabled: true })
      expect(seeded.other).toEqual({
        ...DEFAULT_CONFIG.other,
        artistAliases: { '旧名': '新名' },
      })
    } finally {
      database.close()
    }
  })
})
