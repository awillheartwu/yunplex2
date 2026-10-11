import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { getDownloadQueueControl, coolDownDownloadQueue } from './queue-control'

interface RequestContext { signal?: AbortSignal; onActivity?: () => void; transportError?: { status: number; retryAfterMs?: number } }
interface AxiosRequest { signal?: AbortSignal; timeout?: number }
interface AxiosResponse { status: number; headers?: Record<string, string> }
interface AxiosError { response?: AxiosResponse }
interface AxiosTransport {
  interceptors: {
    request: { use(handler: (config: AxiosRequest) => AxiosRequest): unknown }
    response: { use(success: (response: AxiosResponse) => AxiosResponse, failure: (error: AxiosError) => Promise<never>): unknown }
  }
}

const context = new AsyncLocalStorage<RequestContext>()
let installed = false
let nextRequestAt = 0
export const DOWNLOAD_METADATA_TIMEOUT_MS = 30_000
const REQUEST_INTERVAL_MS = 250

/** Scope transport options to this download; don't change SDK calls elsewhere. */
export function withDownloadRequestContext<T>(signal: AbortSignal | undefined, action: () => Promise<T>, onActivity?: () => void): Promise<T> {
  return context.run({ signal, onActivity }, action)
}

function installTransportOptions() {
  if (installed) return
  // The SDK currently doesn't forward timeout/signal through its query API.
  // Use its own Axios instance, with AsyncLocalStorage to isolate concurrent
  // callers, rather than modifying dependencies or abandoning its encryption.
  const require = createRequire(import.meta.url)
  const sdkRequire = createRequire(require.resolve('NeteaseCloudMusicApi'))
  const transport = sdkRequire('axios').default as AxiosTransport
  transport.interceptors.request.use(config => {
    const active = context.getStore()
    if (active) { config.signal = active.signal; config.timeout = DOWNLOAD_METADATA_TIMEOUT_MS }
    return config
  })
  transport.interceptors.response.use(response => response, async error => {
    const active = context.getStore()
    if (active && error.response) {
      active.transportError = { status: error.response.status, retryAfterMs: retryAfterMs(error.response.headers?.['retry-after']) }
    }
    throw error
  })
  installed = true
}

export async function controlledNeteaseRequest<T>(action: () => Promise<T>): Promise<T> {
  const parent = context.getStore()
  if (!parent) return action()
  installTransportOptions()
  await waitForRequestSlot(parent.signal, parent.onActivity)
  const controller = new AbortController()
  const signal = parent.signal ? AbortSignal.any([parent.signal, controller.signal]) : controller.signal
  const requestContext: RequestContext = { signal }
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('网易云请求超时'), { code: 'ETIMEDOUT' })), DOWNLOAD_METADATA_TIMEOUT_MS)
  try {
    const result = await context.run(requestContext, () => abortable(action(), signal))
    const response = result as { status?: number; body?: { code?: number } } | null
    if (Number(response?.status) >= 400 || [301, 401, 403, 429].includes(Number(response?.body?.code))) throw result
    return result
  } catch (error) {
    if (signal.aborted) throw signal.reason
    const response = error as { status?: number; body?: { code?: number; msg?: string } } | null
    const status = requestContext.transportError?.status ?? Number(response?.body?.code || response?.status || 0)
    if ([301, 401, 403].includes(status)) throw Object.assign(new Error('网易云登录已失效，请更新 Cookie'), { httpStatus: status, code: 'AUTHENTICATION_FAILED' })
    if (status === 429) {
      const delay = Math.max(30_000, requestContext.transportError?.retryAfterMs ?? 0)
      coolDownDownloadQueue(delay)
      throw Object.assign(new Error('网易云请求受限，请稍后重试（HTTP 429）'), { httpStatus: status, retryAfterMs: delay })
    }
    if (status) throw Object.assign(new Error(`网易云服务请求失败（HTTP ${status}）`), { httpStatus: status })
    throw error
  } finally { clearTimeout(timer) }
}

async function waitForRequestSlot(signal?: AbortSignal, onActivity?: () => void) {
  while (true) {
    signal?.throwIfAborted()
    const cooldown = getDownloadQueueControl().cooldownUntil
    const due = Math.max(nextRequestAt, cooldown ? Date.parse(cooldown) : 0)
    if (Date.now() >= due) { nextRequestAt = Date.now() + REQUEST_INTERVAL_MS; return }
    onActivity?.()
    await abortable(new Promise<void>(resolve => setTimeout(resolve, Math.min(250, due - Date.now()))), signal)
  }
}

function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  if (signal.aborted) { void pending.catch(() => undefined); return Promise.reject(signal.reason) }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    void pending.then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}

function retryAfterMs(value?: string): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined
}
