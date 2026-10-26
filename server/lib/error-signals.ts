export interface ErrorSignals {
  chain: Array<Record<string, unknown>>
  code: string
  message: string
  status: number
  provider: string | null
  phase: string | null
  retryAfterMs: number | null
}

export function errorSignals(error: unknown): ErrorSignals {
  const chain: Array<Record<string, unknown>> = []
  if (typeof error === 'string') chain.push({ message: error })
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
  const retryAfterMs = Number(chain.find(item => item.retryAfterMs !== undefined)?.retryAfterMs)
  const provider = chain.find(item => typeof item.provider === 'string')?.provider
  const context = chain.find(item => typeof item.phase === 'string' || typeof item.stage === 'string')
  const phase = typeof context?.phase === 'string' ? context.phase : context?.stage
  return { chain, code, message, status,
    provider: typeof provider === 'string' ? provider : null,
    phase: typeof phase === 'string' ? phase : null,
    retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : null }
}
