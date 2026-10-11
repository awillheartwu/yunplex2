import { getDb } from '../db'
import { getDownloadQueueControl, ELIGIBLE_DOWNLOAD_CALLERS_SQL } from './queue-control'

export interface DownloadTaskWaitOptions {
  taskIds: readonly string[]
  /** Optional total wall-clock budget; normal callers use progress-based waiting. */
  timeoutMs?: number
  inactivityTimeoutMs?: number
  throwIfCancelled?: () => void
  pollIntervalMs?: number
  onProgress?: (progress: { settled: number; total: number }) => void
}

export async function waitForDownloadTasks(input: DownloadTaskWaitOptions): Promise<void> {
  const ids = [...new Set(input.taskIds)]
  if (!ids.length) return
  const started = Date.now()
  let lastActivity = started, signature = '', previousSettled = -1
  while (true) {
    input.throwIfCancelled?.()
    let remaining = 0, latestUpdate = '', paused = false, delayed = false, observed = 0
    // Stay below SQLite parameter limits even for much larger collections.
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500)
      const row = getDb().prepare(`SELECT COUNT(*) AS observed,
        SUM(CASE WHEN status IN ('pending','downloading','tagging') THEN 1 ELSE 0 END) AS remaining,
        MAX(updated_at) AS latest,
        SUM(CASE WHEN status='pending' AND NOT ${ELIGIBLE_DOWNLOAD_CALLERS_SQL} THEN 1 ELSE 0 END) AS paused,
        SUM(CASE WHEN status='pending' AND next_attempt_at > ? THEN 1 ELSE 0 END) AS delayed
        FROM download_tasks WHERE id IN (${batch.map(() => '?').join(',')})
      `).get(new Date().toISOString(), ...batch) as { observed: number; remaining: number; latest: string | null; paused: number; delayed: number }
      observed += row.observed
      remaining += row.remaining ?? 0
      latestUpdate = row.latest && row.latest > latestUpdate ? row.latest : latestUpdate
      paused ||= row.paused > 0
      delayed ||= row.delayed > 0
    }
    if (observed !== ids.length) throw new Error('下载任务记录缺失，无法确认本批处理结果')
    const settled = ids.length - remaining
    if (settled !== previousSettled) { previousSettled = settled; input.onProgress?.({ settled, total: ids.length }) }
    if (!remaining) return
    const control = getDownloadQueueControl()
    // Other callers may occupy the global slots ahead of this caller's queue.
    const global = getDb().prepare("SELECT MAX(updated_at) AS latest FROM download_tasks WHERE status IN ('downloading','tagging')").get() as { latest: string | null }
    const nextSignature = `${remaining}:${latestUpdate}:${global.latest ?? ''}`
    if (nextSignature !== signature || paused || delayed || control.paused || control.cooldownUntil) {
      lastActivity = Date.now(); signature = nextSignature
    }
    if (input.timeoutMs !== undefined && Date.now() - started >= input.timeoutMs) throw new Error('等待下载任务完成超时')
    if (Date.now() - lastActivity >= (input.inactivityTimeoutMs ?? 10 * 60 * 1000)) {
      throw new Error('下载队列长时间无进展，请检查下载消费者和连接状态')
    }
    await new Promise(resolve => setTimeout(resolve, input.pollIntervalMs ?? 1000))
  }
}
