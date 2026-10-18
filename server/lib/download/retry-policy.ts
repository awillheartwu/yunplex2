export interface DownloadFailurePolicy {
  pauseReason?: 'authentication' | 'filesystem'
  cooldownMs?: number
}

export interface ErrorSignals {
  chain: Array<Record<string, unknown>>
  code: string
  message: string
  status: number
}

export function errorSignals(error: unknown): ErrorSignals {
  const chain: Array<Record<string, unknown>> = []
  let current = error
  while (current && typeof current === 'object' && chain.length < 5) {
    chain.push(current as Record<string, unknown>)
    current = (current as { cause?: unknown }).cause
  }
  const message = chain.map(item => String(item.message ?? '')).join(' ').toLowerCase()
  const code = chain.map(item => String(item.code ?? '')).join(' ')
  const failedRequest = chain.find(item => item.httpStatus || item.providerCode || item.status)
  const httpStatus = Number(failedRequest?.httpStatus || 0)
  const status = httpStatus >= 400 ? httpStatus : Number(failedRequest?.providerCode || failedRequest?.status || httpStatus)
  return { chain, code, message, status }
}

/** Backpressure stops other pending requests; failed tasks wait for the next source sync. */
export function downloadFailurePolicy(error: unknown): DownloadFailurePolicy {
  const { chain, code, message, status } = errorSignals(error)
  if (/ENOSPC|EACCES|EPERM|EROFS/.test(code) || /磁盘.*(?:满|空间)|空间不足|只读文件系统/.test(message)) {
    return { pauseReason: 'filesystem' }
  }
  if (status === 401 || /AUTHENTICATION_FAILED/.test(code)
    || /登录状态|登录.*(?:失效|过期)|未登录|认证失效|cookie.*(?:失效|过期)|unauthori[sz]ed/.test(message)) {
    return { pauseReason: 'authentication' }
  }
  if (status === 429 || /限流|请求.*频繁|rate.?limit|too many requests/.test(message)) {
    const retryAfter = Number(chain.find(item => item.retryAfterMs)?.retryAfterMs ?? 0)
    return { cooldownMs: Math.max(30_000, Number.isFinite(retryAfter) ? retryAfter : 0) }
  }
  return {}
}
