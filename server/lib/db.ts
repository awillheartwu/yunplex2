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
  runMigrations(db)
  seedConfig(db, dataDir)

  return db
}

// ── Schema migrations ──

const MIGRATIONS: Array<(d: Database.Database) => void> = [
  /* v1: initial schema — covered by createSchema */
  /* v2: add last_job_id to playlist_sources */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN last_job_id TEXT').run() },
  /* v3: add auto_create_plex_playlist to playlist_sources */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN auto_create_plex_playlist INTEGER NOT NULL DEFAULT 0').run() },
  /* v4: song_lookup table for Plex track caching */
  (d) => {
    d.prepare(`
      CREATE TABLE IF NOT EXISTS song_lookup (
        netease_song_id   INTEGER PRIMARY KEY,
        plex_rating_key   TEXT,
        file_path         TEXT,
        last_verified_at  TEXT NOT NULL
      )
    `).run()
    d.prepare('CREATE INDEX IF NOT EXISTS idx_song_lookup_rating_key ON song_lookup(plex_rating_key)').run()
  },
  /* v5: add last_track_update_time to playlist_sources */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN last_track_update_time INTEGER').run() },
  /* v6: add force_full_compare to playlist_sources */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN force_full_compare INTEGER NOT NULL DEFAULT 0').run() },
  /* v7: add skip tracking + plex timestamp to playlist_sources */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN consecutive_skips INTEGER NOT NULL DEFAULT 0').run()
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN last_full_compare_at TEXT').run()
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN plex_updated_at INTEGER').run()
  },
  /* v8: add track ID snapshot for incremental diff */
  (d) => { d.prepare('ALTER TABLE playlist_sources ADD COLUMN track_id_snapshot TEXT').run() },
  /* v9: add netease playlist name for display */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN netease_playlist_name TEXT NOT NULL DEFAULT \'\'').run()
    d.prepare("UPDATE playlist_sources SET netease_playlist_name = name WHERE netease_playlist_name = ''").run()
  },
  /* v10: add sort_order for drag-and-drop ordering */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0').run()
    // Backfill: assign sort_order based on created_at (oldest first)
    const rows = d.prepare('SELECT id FROM playlist_sources ORDER BY created_at ASC').all() as { id: string }[]
    const stmt = d.prepare('UPDATE playlist_sources SET sort_order = ? WHERE id = ?')
    rows.forEach((r, i) => stmt.run(i, r.id))
  },
  /* v11: add removed_songs to jobs */
  (d) => {
    d.prepare('ALTER TABLE jobs ADD COLUMN removed_songs INTEGER NOT NULL DEFAULT 0').run()
  },
  /* v12: per-source skip/full-compare overrides */
  (d) => {
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN full_compare_after_skips INTEGER').run()
    d.prepare('ALTER TABLE playlist_sources ADD COLUMN full_compare_after_days INTEGER').run()
  },
]

function runMigrations(d: Database.Database): void {
  const currentVersion = (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const m = MIGRATIONS[i]
    if (!m) continue
    try { m(d) } catch { /* already applied or harmless */ }
  }
  if (currentVersion < MIGRATIONS.length) {
    d.pragma(`user_version = ${MIGRATIONS.length}`)
  }
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
      removed_songs  INTEGER NOT NULL DEFAULT 0,
      warnings       INTEGER NOT NULL DEFAULT 0,
      dry_run        INTEGER NOT NULL DEFAULT 0,
      source         TEXT NOT NULL DEFAULT '网易云音乐',
      target         TEXT NOT NULL DEFAULT 'Plex',
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      data           TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_started ON jobs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

    CREATE TABLE IF NOT EXISTS downloads (
      id             TEXT PRIMARY KEY,
      song_name      TEXT NOT NULL,
      artist         TEXT NOT NULL DEFAULT '',
      album          TEXT NOT NULL DEFAULT '',
      file_path      TEXT,
      file_type      TEXT,
      quality        TEXT,
      status         TEXT NOT NULL DEFAULT 'success',
      downloaded_at  TEXT NOT NULL,
      job_id         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_downloads_time ON downloads(downloaded_at DESC);

    CREATE TABLE IF NOT EXISTS download_tasks (
      id              TEXT PRIMARY KEY,
      source_id       TEXT NOT NULL,
      song_id         INTEGER NOT NULL,
      song_name       TEXT NOT NULL,
      artist          TEXT NOT NULL DEFAULT '',
      album           TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','downloading','tagging','done','failed')),
      progress        INTEGER NOT NULL DEFAULT 0,
      file_path       TEXT,
      file_type       TEXT,
      quality         TEXT,
      error           TEXT,
      retry_count     INTEGER NOT NULL DEFAULT 0,
      job_id          TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_download_tasks_source ON download_tasks(source_id);

    CREATE TABLE IF NOT EXISTS playlist_sources (
      id                      TEXT PRIMARY KEY,
      netease_playlist_id     INTEGER NOT NULL UNIQUE,
      name                    TEXT NOT NULL DEFAULT '',
      enabled                 INTEGER NOT NULL DEFAULT 1,
      plex_playlist_name      TEXT NOT NULL DEFAULT '',
      plex_playlist_rating_key TEXT NOT NULL DEFAULT '',
      sync_limit              INTEGER,
      last_synced_at          TEXT,
      last_status             TEXT NOT NULL DEFAULT 'idle',
      last_error              TEXT,
      last_job_id             TEXT,
      auto_create_plex_playlist INTEGER NOT NULL DEFAULT 0,
      track_count              INTEGER NOT NULL DEFAULT 0,
      last_track_update_time  INTEGER,
      force_full_compare      INTEGER NOT NULL DEFAULT 0,
      consecutive_skips       INTEGER NOT NULL DEFAULT 0,
      full_compare_after_skips INTEGER,
      full_compare_after_days  INTEGER,
      last_full_compare_at    TEXT,
      plex_updated_at         INTEGER,
      track_id_snapshot       TEXT,
      netease_playlist_name   TEXT NOT NULL DEFAULT '',
      sort_order              INTEGER NOT NULL DEFAULT 0,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_sources_enabled ON playlist_sources(enabled);

    CREATE TABLE IF NOT EXISTS song_lookup (
      netease_song_id   INTEGER PRIMARY KEY,
      plex_rating_key   TEXT,
      file_path         TEXT,
      last_verified_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_song_lookup_rating_key ON song_lookup(plex_rating_key);

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
