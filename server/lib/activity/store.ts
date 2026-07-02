import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { readConfig } from '../config/store'
import { dateEndBoundary, dateStartBoundary } from '../date-range'
import type {
  ActivityDomain,
  ActivityEvent,
  ActivityEventListFilter,
  ActivitySeverity,
  CreateActivityEventInput,
} from './types'

interface ActivityEventRow {
  id: string
  domain: ActivityDomain
  type: string
  severity: ActivitySeverity
  occurred_at: string
  actor: 'system' | 'user'
  title: string
  summary: string
  context: string
  link: string | null
  group_key: string | null
}

function rowToActivityEvent(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    domain: row.domain,
    type: row.type,
    severity: row.severity,
    occurredAt: row.occurred_at,
    actor: row.actor,
    title: row.title,
    summary: row.summary,
    context: parseContext(row.context),
    link: row.link,
    groupKey: row.group_key,
  }
}

function parseContext(raw: string): ActivityEvent['context'] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ActivityEvent['context'] : {}
  } catch {
    return {}
  }
}

export function cleanupOldActivityEvents(retentionDays: number): number {
  if (!retentionDays || retentionDays <= 0) return 0
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = getDb().prepare(
    'DELETE FROM activity_events WHERE occurred_at < ?',
  ).run(cutoff)
  return result.changes
}

export function recordActivityEvent(input: CreateActivityEventInput): ActivityEvent {
  const db = getDb()
  try {
    cleanupOldActivityEvents(readConfig().sync.activityRetentionDays ?? 30)
  } catch {
    cleanupOldActivityEvents(30)
  }

  const event: ActivityEvent = {
    id: randomUUID(),
    domain: input.domain,
    type: input.type,
    severity: input.severity,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    actor: input.actor ?? 'system',
    title: input.title,
    summary: input.summary,
    context: input.context ?? {},
    link: input.link ?? null,
    groupKey: input.groupKey ?? null,
  }

  db.prepare(`
    INSERT INTO activity_events (id, domain, type, severity, occurred_at, actor, title, summary, context, link, group_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.domain,
    event.type,
    event.severity,
    event.occurredAt,
    event.actor,
    event.title,
    event.summary,
    JSON.stringify(event.context),
    event.link,
    event.groupKey,
  )

  return event
}

export function listActivityEvents(filter: ActivityEventListFilter = {}): { items: ActivityEvent[]; total: number } {
  const db = getDb()
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0
  const query = filter.query?.trim()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter.domains?.length) {
    conditions.push(`domain IN (${filter.domains.map(() => '?').join(', ')})`)
    params.push(...filter.domains)
  }

  if (filter.severities?.length) {
    conditions.push(`severity IN (${filter.severities.map(() => '?').join(', ')})`)
    params.push(...filter.severities)
  }

  if (filter.from) {
    const boundary = dateStartBoundary(filter.from, filter.timeZone)
    conditions.push(`occurred_at ${boundary.exclusive ? '>' : '>='} ?`)
    params.push(boundary.value)
  }

  if (filter.to) {
    const boundary = dateEndBoundary(filter.to, filter.timeZone)
    conditions.push(`occurred_at ${boundary.exclusive ? '<' : '<='} ?`)
    params.push(boundary.value)
  }

  if (query) {
    conditions.push('(title LIKE ? OR summary LIKE ? OR type LIKE ?)')
    const like = `%${query}%`
    params.push(like, like, like)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM activity_events ${where}`).get(...params) as { cnt: number }).cnt
  const rows = db.prepare(
    `SELECT * FROM activity_events ${where} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as ActivityEventRow[]

  return {
    items: rows.map(rowToActivityEvent),
    total,
  }
}
