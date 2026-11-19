import { coolDownDownloadQueue, pauseDownloadQueue } from './queue-control'
import { downloadFailurePolicy } from './retry-policy'

export function applyDownloadFailureBackpressure(error: unknown): void {
  const policy = downloadFailurePolicy(error)
  if (policy.cooldownMs) coolDownDownloadQueue(policy.cooldownMs)
  if (policy.pauseReason) {
    pauseDownloadQueue(policy.pauseReason, policy.pauseReason === 'authentication'
      ? '网易云登录已失效，更新 Cookie 后继续下载。'
      : '下载目录无法写入，请检查剩余空间、挂载和权限后继续下载。')
  }
}
