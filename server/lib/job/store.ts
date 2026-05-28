import type { SyncJob, JobSummary, JobFilter } from './types'
import { getDb } from '../db'

export function saveJob(job: SyncJob): void {
  const db = getDb()
  db.prepare(`
    INSERT OR REPLACE INTO jobs (id, started_at, finished_at, status, summary, total_songs, success_songs, failed_songs, skipped_songs, warnings, dry_run, source, target, duration_ms, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id, job.startedAt, job.finishedAt, job.status, job.summary,
    job.totalSongs, job.successSongs, job.failedSongs, job.skippedSongs,
    job.warnings, job.dryRun ? 1 : 0, job.source, job.target,
    job.durationMs, JSON.stringify(job),
  )
}

export function getJob(id: string): SyncJob | null {
  const db = getDb()
  const row = db.prepare('SELECT data FROM jobs WHERE id = ?').get(id) as { data: string } | undefined
  if (!row) return null
  return JSON.parse(row.data) as SyncJob
}

export function listJobs(filter: JobFilter = {}): { items: JobSummary[]; total: number; earliestDate: string | null } {
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter.search) {
    conditions.push('(summary LIKE ? OR id LIKE ? OR data LIKE ?)')
    const q = `%${filter.search}%`
    params.push(q, q, q)
  }
  if (filter.from) {
    conditions.push('started_at >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    conditions.push('started_at <= ?')
    params.push(filter.to)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0

  const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM jobs ${where}`).get(...params) as { cnt: number }
  const rows = db.prepare(
    `SELECT id, started_at, finished_at, status, duration_ms, summary, total_songs, success_songs, failed_songs, skipped_songs, removed_songs, dry_run
     FROM jobs ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as Array<{
    id: string; started_at: string; finished_at: string | null; status: string;
    duration_ms: number; summary: string; total_songs: number; success_songs: number;
    failed_songs: number; skipped_songs: number; removed_songs: number; dry_run: number;
  }>

  const earliest = db.prepare('SELECT MIN(started_at) as d FROM jobs').get() as { d: string | null }
  return {
    items: rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status as JobSummary['status'],
      durationMs: r.duration_ms,
      summary: r.summary,
      totalSongs: r.total_songs,
      successSongs: r.success_songs,
      failedSongs: r.failed_songs,
      skippedSongs: r.skipped_songs,
      removedSongs: r.removed_songs ?? 0,
      dryRun: r.dry_run === 1,
    })),
    total: totalRow.cnt,
    earliestDate: earliest.d ? earliest.d.slice(0, 10) : null,
  }
}

export function deleteJob(id: string): void {
  getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id)
}

export function clearAllJobs(): void {
  getDb().prepare('DELETE FROM jobs').run()
}

export function getJobCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as cnt FROM jobs').get() as { cnt: number }
  return row.cnt
}

export function cleanupOldJobs(successDays: number, failedDays: number): void {
  const db = getDb()
  // Successful jobs expire after successDays
  db.prepare(
    "DELETE FROM jobs WHERE status IN ('success','cancelled') AND started_at < datetime('now', ?)",
  ).run(`-${successDays} days`)
  // Failed/partial jobs expire after failedDays
  db.prepare(
    "DELETE FROM jobs WHERE status IN ('failed','partial') AND started_at < datetime('now', ?)",
  ).run(`-${failedDays} days`)
}
