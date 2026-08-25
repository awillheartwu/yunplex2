import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { AppConfig } from './config/types'
import { DEFAULT_CONFIG } from './config/defaults'
import { migrateConfig } from './config/validation'
import { seedConfig, coerceValue } from './db/config-seed'
import { createSchema } from './db/schema'
import { runMigrations } from './db/migrations'

let db: Database.Database | null = null

export { coerceValue }

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

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function readConfigFromDb(): AppConfig {
  const raw = readRawConfigFromDb()
  if (!raw) return structuredClone(DEFAULT_CONFIG)
  return migrateConfig(raw).config
}

export function readRawConfigFromDb(): unknown | null {
  const d = getDb()
  const row = d.prepare('SELECT value FROM config WHERE key = ?').get('app') as { value: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

export function writeConfigToDb(config: AppConfig): void {
  const d = getDb()
  d.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('app', JSON.stringify(config, null, 2))
}
