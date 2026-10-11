import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { emitEvent } from '../sync/events'
import { isTagWriteError } from '../tag-writer'
import { commitCompletedMediaWrite } from './media-write'
import {
  claimDownloadTask, getDownloadTask, getQueueStatus, recoverExpiredDownloadTasks, updateTaskState,
  DOWNLOAD_TASK_INACTIVITY_TIMEOUT_MS, DOWNLOAD_TASK_LEASE_MS,
  type DownloadTask, type DownloadProcessor, type DownloadProcessorResult, type ProcessDownloadQueueOptions,
} from './queue'
import { deferFailedDownloadTask } from './retry-store'

export async function executeDownloadTasks(
  processor: DownloadProcessor,
  jobId?: string,
  concurrency = 3,
  taskIds?: string[],
  options: ProcessDownloadQueueOptions = {},
): Promise<number> {
  const db = getDb()
  recoverExpiredDownloadTasks()
  const conditions = taskIds?.length
    ? ["status IN ('pending','failed','downloading','tagging')"]
    : ["status IN ('pending','failed')"]
  const queryParams: unknown[] = []
  if (jobId) {
    conditions.push('COALESCE(run_id, job_id) = ?')
    queryParams.push(jobId)
  }
  if (taskIds?.length) {
    conditions.push(`id IN (${taskIds.map(() => '?').join(',')})`)
    queryParams.push(...taskIds)
  }
  const where = `WHERE ${conditions.join(' AND ')}`
  const rows = db.prepare(`SELECT id FROM download_tasks ${where} ORDER BY created_at ASC`).all(...queryParams) as Array<{ id: string }>
  const tasks = rows.map(row => getDownloadTask(row.id)).filter((task): task is DownloadTask => task !== null)
  if (tasks.length === 0) return 0

  const leaseOwner = randomUUID()
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? DOWNLOAD_TASK_INACTIVITY_TIMEOUT_MS
  const leaseDurationMs = options.leaseDurationMs ?? DOWNLOAD_TASK_LEASE_MS
  let completed = 0
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      if (options.shouldStop?.()) return
      const selected = tasks[idx++]
      if (!selected) continue
      const task = claimDownloadTask(selected.id, leaseOwner, leaseDurationMs)
      if (!task) continue
      try {
        emitEvent({
          type: 'queue-update',
          data: { taskId: task.id, songName: task.songName, status: 'downloading', progress: 0, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })

        const abortController = new AbortController()
        let watchdog: ReturnType<typeof setTimeout> | undefined
        let watchdogActive = true
        let lastPersistedAt = 0, lastProgress = -1, lastPhase = ''
        const resetWatchdog = (reject: (reason: Error) => void) => {
          if (!watchdogActive) return
          if (watchdog) clearTimeout(watchdog)
          watchdog = setTimeout(() => {
            if (!watchdogActive) return
            watchdogActive = false
            abortController.abort()
            reject(new Error(`任务无进展超时（>${Math.ceil(inactivityTimeoutMs / 1000)} 秒），已释放下载队列槽位`))
          }, inactivityTimeoutMs)
          watchdog.unref?.()
        }
        const result = await new Promise<DownloadProcessorResult>((resolve, reject) => {
          resetWatchdog(reject)
          void processor(task, (pct, phase) => {
            if (!watchdogActive) return
            resetWatchdog(reject)
            const status = phase || 'downloading'
            const now = Date.now()
            // Every byte refreshes the stall watchdog; persist only visible
            // changes or a periodic heartbeat instead of every network chunk.
            if (status === lastPhase && now - lastPersistedAt < 500) return
            if (status === lastPhase && pct === lastProgress && now - lastPersistedAt < 5000) return
            lastPersistedAt = now; lastProgress = pct; lastPhase = status
            const updated = updateTaskState(task.id, {
              progress: pct,
              status,
              leaseExpiresAt: new Date(Date.now() + leaseDurationMs).toISOString(),
            }, { leaseOwner })
            if (!updated) return
            emitEvent({
              type: 'queue-update',
              data: { taskId: task.id, songName: task.songName, status, progress: pct, sourceId: task.sourceId },
              timestamp: new Date().toISOString(),
            })
          }, abortController.signal).then(
            value => {
              if (!watchdogActive) return
              watchdogActive = false
              resolve(value)
            },
            error => {
              if (!watchdogActive) return
              watchdogActive = false
              reject(error)
            },
          )
        }).finally(() => {
          watchdogActive = false
          if (watchdog) clearTimeout(watchdog)
        })

        // Tag-writing failures must not silently pass as "done"
        if (result.ops?.tags === 'failed') {
          const detail = result.ops.error || '未知标签错误'
          const msg = `标签写入失败: ${task.songName} — ${detail}`
          const updated = updateTaskState(task.id, {
            status: 'failed',
            error: msg,
            progress: 0,
            filePath: result.filePath,
            fileType: result.fileType,
            leaseOwner: null,
            leaseExpiresAt: null,
          }, { leaseOwner })
          if (!updated) continue

          emitEvent({
            type: 'song-progress',
            data: {
              taskId: task.id,
              songName: task.songName,
              status: 'failed',
              error: msg,
              completed: ++completed,
              total: tasks.length,
              sourceId: task.sourceId ?? undefined,
              filePath: result.filePath,
              fileType: result.fileType,
            },
            timestamp: new Date().toISOString(),
          })
          options.onTaskSettled?.(task, 'failed', { completed, total: tasks.length })
          continue
        }

        const updated = getDb().transaction(() => {
          const accepted = updateTaskState(task.id, {
            status: 'done', progress: 100,
            filePath: result.filePath, fileType: result.fileType,
            error: null,
            leaseOwner: null,
            leaseExpiresAt: null,
          }, { leaseOwner })
          if (!accepted) return false
          commitCompletedMediaWrite({
            neteaseSongId: task.songId,
            filePath: result.filePath,
            provenance: task.operation === 'repair_existing' ? 'manual' : 'download_task',
            taskId: task.id,
            audioDownloaded: result.ops?.download === 'ok',
            audioOperation: result.audioOperation,
            runId: task.jobId ?? null,
            sourceId: task.sourceId,
          })
          return true
        })()
        if (!updated) continue

        emitEvent({
          type: 'song-progress',
          data: { taskId: task.id, songName: task.songName, status: 'done', completed: ++completed, total: tasks.length, sourceId: task.sourceId },
          timestamp: new Date().toISOString(),
        })
        options.onTaskSettled?.(task, 'done', { completed, total: tasks.length })
      } catch (err) {
        const tagError = isTagWriteError(err) ? err : null
        const msg = tagError ? tagError.message : err instanceof Error ? err.message : '下载失败'
        if (options.automaticRetries && deferFailedDownloadTask(task, err, leaseOwner)) {
          emitEvent({ type: 'queue-update', data: { taskId: task.id, status: 'pending', error: msg }, timestamp: new Date().toISOString() })
          continue
        }
        const updated = updateTaskState(task.id, {
          status: 'failed',
          error: msg,
          progress: 0,
          ...(tagError?.filePath ? { filePath: tagError.filePath } : {}),
          ...(tagError?.fileType ? { fileType: tagError.fileType } : {}),
          leaseOwner: null,
          leaseExpiresAt: null,
        }, { leaseOwner })
        if (!updated) continue

        emitEvent({
          type: 'song-progress',
          data: {
            taskId: task.id,
            songName: task.songName,
            status: 'failed',
            error: msg,
            completed: ++completed,
            total: tasks.length,
            sourceId: task.sourceId,
            ...(tagError?.filePath ? { filePath: tagError.filePath } : {}),
            ...(tagError?.fileType ? { fileType: tagError.fileType } : {}),
          },
          timestamp: new Date().toISOString(),
        })
        options.onTaskSettled?.(task, 'failed', { completed, total: tasks.length })
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
  // Count only tasks matching the same filter as the workers (batch-specific if jobId provided)
  const countConditions = ["status = 'failed'"]
  const countParams: unknown[] = []
  if (jobId) {
    countConditions.push('COALESCE(run_id, job_id) = ?')
    countParams.push(jobId)
  }
  if (taskIds?.length) {
    countConditions.push(`id IN (${taskIds.map(() => '?').join(',')})`)
    countParams.push(...taskIds)
  }
  const failed = (db.prepare(
    `SELECT COUNT(*) as cnt FROM download_tasks WHERE ${countConditions.join(' AND ')}`,
  ).get(...countParams) as { cnt: number }).cnt
  emitEvent({
    type: 'queue-update',
    data: { status: 'complete', ...getQueueStatus() },
    timestamp: new Date().toISOString(),
  })

  return failed
}
