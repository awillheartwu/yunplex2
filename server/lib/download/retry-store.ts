import { getDb } from '../db'
import { coolDownDownloadQueue, pauseDownloadQueue } from './queue-control'
import { downloadFailurePolicy, downloadRetryDelayMs, MAX_AUTOMATIC_DOWNLOAD_RETRIES } from './retry-policy'
import type { DownloadTask } from './queue'

/** Defer an attempt without projecting a terminal failure into caller runs. */
export function deferFailedDownloadTask(task: DownloadTask, error: unknown, leaseOwner: string): boolean {
  const current = getDb().prepare("SELECT 1 FROM download_tasks WHERE id=? AND lease_owner=? AND status IN ('downloading','tagging')").get(task.id, leaseOwner)
  if (!current) return false
  const policy = downloadFailurePolicy(error)
  if (policy.cooldownMs) coolDownDownloadQueue(policy.cooldownMs)
  const message = error instanceof Error ? error.message : '下载失败'
  if (policy.pauseReason) {
    pauseDownloadQueue(policy.pauseReason, policy.pauseReason === 'authentication'
      ? '网易云登录已失效，更新 Cookie 后继续下载。'
      : '下载目录无法写入，请检查剩余空间、挂载和权限后继续下载。')
  }
  const retry = (task.autoRetryCount ?? 0) + 1
  if (!policy.pauseReason && (!policy.retryable || retry > MAX_AUTOMATIC_DOWNLOAD_RETRIES)) return false
  const nextAttempt = policy.pauseReason ? null : new Date(Date.now() + Math.max(
    downloadRetryDelayMs(retry), policy.cooldownMs ?? 0,
  )).toISOString()
  return getDb().prepare(`UPDATE download_tasks SET status='pending',progress=0,error=?,
    auto_retry_count=auto_retry_count+?, retry_count=retry_count+?, next_attempt_at=?,
    lease_owner=NULL,lease_expires_at=NULL,attempt_started_at=NULL,updated_at=?
    WHERE id=? AND lease_owner=? AND status IN ('downloading','tagging')
  `).run(message, policy.pauseReason ? 0 : 1, policy.pauseReason ? 0 : 1, nextAttempt,
    new Date().toISOString(), task.id, leaseOwner).changes > 0
}
