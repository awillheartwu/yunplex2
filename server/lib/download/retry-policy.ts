export const MAX_AUTOMATIC_DOWNLOAD_RETRIES = 3

export interface DownloadFailurePolicy {
  retryable: boolean
  pauseReason?: 'authentication' | 'filesystem'
  cooldownMs?: number
}

/** Only transient failures retry automatically; policy failures need a decision. */
export function downloadFailurePolicy(error: unknown): DownloadFailurePolicy {
  const chain: Array<Record<string, unknown>> = []
  let current = error
  while (current && typeof current === 'object' && chain.length < 5) {
    chain.push(current as Record<string, unknown>)
    current = (current as { cause?: unknown }).cause
  }
  const message = chain.map(item => String(item.message ?? '')).join(' ').toLowerCase()
  const code = chain.map(item => String(item.code ?? '')).join(' ')
  const status = Number(chain.find(item => item.httpStatus || item.status)?.httpStatus
    ?? chain.find(item => item.status)?.status ?? 0)
  if (/ENOSPC|EACCES|EPERM|EROFS/.test(code) || /磁盘.*(?:满|空间)|空间不足|只读文件系统/.test(message)) {
    return { retryable: false, pauseReason: 'filesystem' }
  }
  if (status === 401 || /AUTHENTICATION_FAILED/.test(code)
    || /登录状态|登录.*(?:失效|过期)|未登录|认证失效|cookie.*(?:失效|过期)|unauthori[sz]ed/.test(message)) {
    return { retryable: false, pauseReason: 'authentication' }
  }
  if (status === 429 || /限流|请求.*频繁|rate.?limit|too many requests/.test(message)) {
    const retryAfter = Number(chain.find(item => item.retryAfterMs)?.retryAfterMs ?? 0)
    return { retryable: true, cooldownMs: Math.max(30_000, Number.isFinite(retryAfter) ? retryAfter : 0) }
  }
  if (/DOWNLOAD_TOO_LARGE|INVALID_AUDIO|COPYRIGHT_RESTRICTED/.test(code)
    || /版权|无法获取歌曲.*(?:详情|下载链接)|文件头无效|音频文件无效|歌曲不可用/.test(message)) {
    return { retryable: false }
  }
  // A signed audio URL may expire. A retry obtains a fresh URL, unlike a Cookie
  // authentication error which is annotated by the metadata transport.
  if ([403, 408, 425].includes(status) || status >= 500) return { retryable: true }
  if (status >= 400) return { retryable: false }
  if (/ECONN|ETIMEDOUT|ENET|EHOST|EAI_AGAIN|UND_ERR|EIO|EAGAIN|EBUSY|EMFILE/.test(code)
    || /network|fetch failed|socket|连接|超时|timeout|长度不完整|任务租约过期|\beio\b/.test(message)) {
    return { retryable: true }
  }
  return { retryable: false }
}

export function downloadRetryDelayMs(retry: number, random = Math.random): number {
  const base = Math.min(60_000, 2_000 * 2 ** Math.max(0, retry - 1))
  return Math.round(base * (0.8 + random() * 0.4))
}
