import { getDb } from '../db'
import { createHash } from 'node:crypto'
import type { LogEntry, LogLevel } from './types'
import { resolveDomainErrorDefinition } from '../../../shared/domain-errors'
import { sanitizeDiagnosticMessage } from '../domain-error'

function generateId(): string {
  return createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12)
}

export function appendLog(
  entry: Omit<LogEntry, 'id' | 'timestamp'>,
): LogEntry {
  const db = getDb()
  const full = enrichLogEntry({
    ...entry,
    id: generateId(),
    timestamp: new Date().toISOString(),
  })

  db.prepare(
    'INSERT INTO logs (id, timestamp, level, message, detail, stage) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(full.id, full.timestamp, full.level, full.message, full.detail ?? null, full.stage ?? null)
  return full
}

function enrichLogEntry(entry: LogEntry): LogEntry {
  const message = sanitizeDiagnosticMessage(entry.message) ?? ''
  const detail = sanitizeDiagnosticMessage(entry.detail) ?? undefined
  if (entry.level === 'info') return { ...entry, message, detail }
  const definition = resolveDomainErrorDefinition(entry.errorCode, `${message} ${detail || ''}`)
  return {
    ...entry,
    message,
    detail,
    errorCode: definition.code,
    errorCategory: definition.category,
    retryable: definition.retryable,
  }
}

export function readLogs(
  filter?: { level?: LogLevel; limit?: number; offset?: number },
): { items: LogEntry[]; total: number } {
  const db = getDb()
  const limit = filter?.limit ?? 100
  const offset = filter?.offset ?? 0

  if (filter?.level) {
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM logs WHERE level = ?').get(filter.level) as { cnt: number }).cnt
    const items = (db
      .prepare('SELECT * FROM logs WHERE level = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?')
      .all(filter.level, limit, offset) as LogEntry[]).map(enrichLogEntry)
    return { items, total }
  }

  const total = (db.prepare('SELECT COUNT(*) as cnt FROM logs').get() as { cnt: number }).cnt
  const items = (db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset) as LogEntry[]).map(enrichLogEntry)
  return { items, total }
}
