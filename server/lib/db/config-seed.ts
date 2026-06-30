import Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AppConfig } from '../config/types'
import { DEFAULT_CONFIG } from '../config/defaults'

function deepMerge<T extends Record<string, any>>(base: T, partial: Partial<T>, path = ''): T {
  const result = { ...base }
  for (const key of Object.keys(partial) as (keyof T)[]) {
    const v = partial[key]
    const childPath = path ? `${path}.${String(key)}` : String(key)
    if (v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (childPath === 'other.artistAliases') {
        ;(result as Record<string, unknown>)[key as string] = { ...(v as Record<string, unknown>) }
      } else {
        ;(result as Record<string, unknown>)[key as string] = deepMerge(
          (base[key] as Record<string, unknown>) || {},
          v as Record<string, unknown>,
          childPath,
        )
      }
    } else if (v !== undefined) {
      ;(result as Record<string, unknown>)[key as string] = v
    }
  }
  return result
}

export function seedConfig(d: Database.Database, dataDir: string): void {
  const row = d.prepare('SELECT COUNT(*) as cnt FROM config').get() as { cnt: number }
  if (row.cnt > 0) return // Already configured, skip seeding

  let seeded: AppConfig | null = null

  // 1. Try YUNPLEX2_CONFIG env var (full JSON)
  if (process.env.YUNPLEX2_CONFIG) {
    try {
      const envConfig = JSON.parse(process.env.YUNPLEX2_CONFIG)
      seeded = deepMerge(DEFAULT_CONFIG, envConfig as Record<string, any>) as AppConfig
      console.log('[YunPlex2] 配置已从 YUNPLEX2_CONFIG 环境变量注入')
    } catch {
      console.warn('[YunPlex2] YUNPLEX2_CONFIG 解析失败，跳过')
    }
  }

  // 2. Try individual env vars (highest priority fields)
  const envPatch: Record<string, unknown> = {}
  const envMap: Record<string, [string, string]> = {
    YUNPLEX2_NETEASE_COOKIE: ['netease', 'cookie'],
    YUNPLEX2_NETEASE_QUALITY: ['netease', 'quality'],
    YUNPLEX2_PLEX_SERVER: ['plex', 'server'],
    YUNPLEX2_PLEX_PORT: ['plex', 'port'],
    YUNPLEX2_PLEX_TOKEN: ['plex', 'token'],
    YUNPLEX2_PLEX_SECTION: ['plex', 'section'],
    YUNPLEX2_DOWNLOAD_DIR: ['download', 'dir'],
    YUNPLEX2_PLEX_LIBRARY_PATH_PREFIX: ['download', 'plexLibraryPathPrefix'],
    YUNPLEX2_SYNC_INTERVAL: ['sync', 'intervalMinutes'],
    YUNPLEX2_SYNC_LIMIT: ['sync', 'songLimit'],
    YUNPLEX2_SYNC_ENABLED: ['sync', 'enabled'],
  }

  let envUsed = false
  for (const [envKey, path] of Object.entries(envMap)) {
    const val = process.env[envKey]
    if (val === undefined || val === '') continue
    envUsed = true
    const [section, key] = path
    if (!envPatch[section]) envPatch[section] = {}
    ;(envPatch[section] as Record<string, unknown>)[key] = coerceValue(key, val)
  }

  if (envUsed) {
    seeded = deepMerge(seeded ?? DEFAULT_CONFIG, envPatch as Record<string, any>) as AppConfig
    console.log('[YunPlex2] 配置已从独立环境变量注入')
  }

  // 3. Try seed.json file in data directory
  if (!seeded) {
    const seedFile = resolve(dataDir, 'seed.json')
    if (existsSync(seedFile)) {
      try {
        const fileConfig = JSON.parse(readFileSync(seedFile, 'utf-8'))
        seeded = deepMerge(DEFAULT_CONFIG, fileConfig as Record<string, any>) as AppConfig
        console.log('[YunPlex2] 配置已从 seed.json 文件注入')
      } catch {
        console.warn('[YunPlex2] seed.json 解析失败，跳过')
      }
    }
  }

  // 4. Fall back to defaults
  if (!seeded) {
    seeded = { ...DEFAULT_CONFIG }
    console.log('[YunPlex2] 使用默认配置（可通过环境变量或 seed.json 覆盖）')
  }

  d.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(
    'app', JSON.stringify(seeded, null, 2),
  )
}

export function coerceValue(key: string, val: string): string | number | boolean {
  if (key === 'port' || key === 'intervalMinutes' || key === 'songLimit') {
    const n = parseInt(val, 10)
    return isNaN(n) ? val : n
  }
  if (key === 'enabled') {
    return val === 'true' || val === '1'
  }
  return val
}
