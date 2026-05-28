import { getDb } from '../db'
import { createHash } from 'node:crypto'
import type { LogEntry, LogLevel } from './types'

const MAX_LOG_ROWS = 5000
const TRIM_TO = 2000

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12)
}

export function appendLog(
  _dataDir: string,
  entry: Omit<LogEntry, 'id' | 'timestamp'>,
  retentionDays = 30,
): LogEntry {
  const db = getDb()

  // Clean logs older than retention days
  db.prepare(
    "DELETE FROM logs WHERE timestamp < datetime('now', ?)",
  ).run(`-${retentionDays} days`)

  const full: LogEntry = {
    ...entry,
    id: generateId(),
    timestamp: new Date().toISOString(),
  }

  db.prepare(
    'INSERT INTO logs (id, timestamp, level, message, detail, stage) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(full.id, full.timestamp, full.level, full.message, full.detail ?? null, full.stage ?? null)

  trimIfNeeded(db)
  return full
}

export function readLogs(
  _dataDir: string,
  filter?: { level?: LogLevel; limit?: number; offset?: number },
): { items: LogEntry[]; total: number } {
  const db = getDb()
  const limit = filter?.limit ?? 100
  const offset = filter?.offset ?? 0

  if (filter?.level) {
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM logs WHERE level = ?').get(filter.level) as { cnt: number }).cnt
    const items = db
      .prepare('SELECT * FROM logs WHERE level = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?')
      .all(filter.level, limit, offset) as LogEntry[]
    return { items, total }
  }

  const total = (db.prepare('SELECT COUNT(*) as cnt FROM logs').get() as { cnt: number }).cnt
  const items = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset) as LogEntry[]
  return { items, total }
}

export function clearLogs(_dataDir: string): void {
  const db = getDb()
  db.prepare('DELETE FROM logs').run()
}

function trimIfNeeded(db: ReturnType<typeof getDb>): void {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM logs').get() as { cnt: number }
  if (row.cnt > MAX_LOG_ROWS) {
    const excess = row.cnt - TRIM_TO
    db.prepare(
      'DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY timestamp ASC LIMIT ?)',
    ).run(excess)
  }
}
