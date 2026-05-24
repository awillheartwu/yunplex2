import Database from 'better-sqlite3'
import { resolve, dirname } from 'node:path'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import type { AppConfig } from './config/types'
import { DEFAULT_CONFIG } from './config/defaults'

let db: Database.Database | null = null

function deepMerge<T extends Record<string, unknown>>(base: T, partial: Partial<T>): T {
  const result = { ...base }
  for (const key of Object.keys(partial) as (keyof T)[]) {
    const v = partial[key]
    if (v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      ;(result as Record<string, unknown>)[key as string] = deepMerge(
        (base[key] as Record<string, unknown>) || {},
        v as Record<string, unknown>,
      )
    } else if (v !== undefined) {
      ;(result as Record<string, unknown>)[key as string] = v
    }
  }
  return result
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

export function initDb(dataDir: string): Database.Database {
  const filePath = resolve(dataDir, 'data.db')
  mkdirSync(dirname(filePath), { recursive: true })

  db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  createSchema(db)
  seedConfig(db, dataDir)

  return db
}

// ── Config seeding (runs once on empty DB) ──

function seedConfig(d: Database.Database, dataDir: string): void {
  const row = d.prepare('SELECT COUNT(*) as cnt FROM config').get() as { cnt: number }
  if (row.cnt > 0) return // Already configured, skip seeding

  let seeded: AppConfig | null = null

  // 1. Try YUNPLEX2_CONFIG env var (full JSON)
  if (process.env.YUNPLEX2_CONFIG) {
    try {
      const envConfig = JSON.parse(process.env.YUNPLEX2_CONFIG)
      seeded = deepMerge(DEFAULT_CONFIG, envConfig as Partial<AppConfig>)
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
    YUNPLEX2_NETEASE_PLAYLIST_IDS: ['netease', 'playlistIds'],
    YUNPLEX2_PLEX_SERVER: ['plex', 'server'],
    YUNPLEX2_PLEX_PORT: ['plex', 'port'],
    YUNPLEX2_PLEX_TOKEN: ['plex', 'token'],
    YUNPLEX2_PLEX_SECTION: ['plex', 'section'],
    YUNPLEX2_DOWNLOAD_DIR: ['download', 'dir'],
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
    seeded = deepMerge(seeded ?? DEFAULT_CONFIG, envPatch as Partial<AppConfig>)
    console.log('[YunPlex2] 配置已从独立环境变量注入')
  }

  // 3. Try seed.json file in data directory
  if (!seeded) {
    const seedFile = resolve(dataDir, 'seed.json')
    if (existsSync(seedFile)) {
      try {
        const fileConfig = JSON.parse(readFileSync(seedFile, 'utf-8'))
        seeded = deepMerge(DEFAULT_CONFIG, fileConfig as Partial<AppConfig>)
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

function coerceValue(key: string, val: string): string | number | boolean | number[] {
  if (key === 'port' || key === 'intervalMinutes' || key === 'songLimit') {
    const n = parseInt(val, 10)
    return isNaN(n) ? val : n
  }
  if (key === 'enabled') {
    return val === 'true' || val === '1'
  }
  if (key === 'playlistIds') {
    return val.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
  }
  return val
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id        TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      level     TEXT NOT NULL CHECK(level IN ('info','warn','error','debug')),
      message   TEXT NOT NULL,
      detail    TEXT,
      stage     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);

    CREATE TABLE IF NOT EXISTS sync_state (
      id               INTEGER PRIMARY KEY CHECK(id = 1),
      is_running       INTEGER NOT NULL DEFAULT 0,
      current_stage    TEXT,
      started_at       TEXT,
      last_sync_at     TEXT,
      last_sync_result TEXT,
      sync_count       INTEGER NOT NULL DEFAULT 0,
      success_count    INTEGER NOT NULL DEFAULT 0,
      failure_count    INTEGER NOT NULL DEFAULT 0,
      current_song     TEXT,
      progress_current INTEGER,
      progress_total   INTEGER,
      dry_run          INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO sync_state (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS jobs (
      id             TEXT PRIMARY KEY,
      started_at     TEXT NOT NULL,
      finished_at    TEXT,
      status         TEXT NOT NULL CHECK(status IN ('running','success','partial','failed','cancelled')),
      summary        TEXT NOT NULL DEFAULT '',
      total_songs    INTEGER NOT NULL DEFAULT 0,
      success_songs  INTEGER NOT NULL DEFAULT 0,
      failed_songs   INTEGER NOT NULL DEFAULT 0,
      skipped_songs  INTEGER NOT NULL DEFAULT 0,
      warnings       INTEGER NOT NULL DEFAULT 0,
      dry_run        INTEGER NOT NULL DEFAULT 0,
      source         TEXT NOT NULL DEFAULT '网易云音乐',
      target         TEXT NOT NULL DEFAULT 'Plex',
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      data           TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_started ON jobs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  `)
}

// Config helpers
export function readConfigFromDb(): AppConfig {
  const d = getDb()
  const row = d.prepare('SELECT value FROM config WHERE key = ?').get('app') as { value: string } | undefined
  if (!row) return { ...DEFAULT_CONFIG }
  try {
    const parsed = JSON.parse(row.value)
    return deepMerge(DEFAULT_CONFIG, parsed as Partial<AppConfig>) as AppConfig
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeConfigToDb(config: AppConfig): void {
  const d = getDb()
  d.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('app', JSON.stringify(config, null, 2))
}
