import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const inline = args.find(argument => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const dataDir = readOption(process.argv.slice(2), 'data-dir')?.trim() || './data'
const dbPath = resolve(dataDir, 'data.db')
if (!existsSync(dbPath)) throw new Error(`数据库不存在：${dbPath}`)

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
try {
  const now = new Date().toISOString()
  const configRow = db.prepare("SELECT value FROM config WHERE key = 'app'").get() as { value: string } | undefined
  const configuredConcurrency = configRow
    ? Number((JSON.parse(configRow.value) as { sync?: { downloadConcurrency?: number } }).sync?.downloadConcurrency ?? 1)
    : 1
  const queue = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM source_sync_queue GROUP BY status ORDER BY status
  `).all() as Array<{ status: string; count: number }>
  const activeRequests = db.prepare(`
    SELECT id, source_id AS sourceId, schedule_window AS scheduleWindow,
      status, attempts, lease_owner AS leaseOwner, lease_expires_at AS leaseExpiresAt,
      run_id AS runId, updated_at AS updatedAt
    FROM source_sync_queue
    WHERE status IN ('pending','running')
    ORDER BY available_at, created_at
  `).all() as Array<Record<string, unknown>>
  const expiredRunning = db.prepare(`
    SELECT COUNT(*) AS count FROM source_sync_queue
    WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
  `).get(now) as { count: number }
  const duplicateWindows = db.prepare(`
    SELECT source_id, schedule_window, COUNT(*) AS count
    FROM source_sync_queue
    GROUP BY source_id, schedule_window HAVING COUNT(*) > 1
  `).all()
  const schedulerFailures = db.prepare(`
    SELECT id, name, last_schedule_error AS error, last_scheduled_at AS scheduledAt
    FROM playlist_sources WHERE last_schedule_status = 'failed'
    ORDER BY last_scheduled_at DESC
  `).all()
  const activeDownloads = db.prepare(`
    SELECT COUNT(*) AS count FROM download_tasks WHERE status IN ('downloading','tagging')
  `).get() as { count: number }
  const recentRuns = db.prepare(`
    SELECT id, status, trigger, started_at AS startedAt, finished_at AS finishedAt, summary
    FROM task_runs WHERE trigger = 'schedule'
    ORDER BY started_at DESC LIMIT 10
  `).all()
  const openFailures = db.prepare(`
    SELECT failure_kind AS failureKind, COUNT(*) AS count
    FROM failure_records WHERE status = 'open'
    GROUP BY failure_kind ORDER BY failure_kind
  `).all()

  const violations = [
    ...(activeRequests.filter(request => request.status === 'running').length > 1
      ? ['存在多个同时运行的来源请求'] : []),
    ...(expiredRunning.count > 0 ? [`存在 ${expiredRunning.count} 个租约已过期的运行请求`] : []),
    ...(duplicateWindows.length > 0 ? ['存在重复的来源计划窗口'] : []),
    ...(activeDownloads.count > configuredConcurrency
      ? [`下载并发 ${activeDownloads.count} 超过配置上限 ${configuredConcurrency}`] : []),
  ]

  console.log(JSON.stringify({
    checkedAt: now,
    database: dbPath,
    healthy: violations.length === 0,
    violations,
    scheduler: { queue, activeRequests, schedulerFailures },
    downloads: { active: activeDownloads.count, configuredConcurrency },
    openFailures,
    recentRuns,
  }, null, 2))
  if (violations.length > 0) process.exitCode = 1
} finally {
  db.close()
}
