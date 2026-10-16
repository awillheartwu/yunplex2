import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDownloadQueueControl, coolDownDownloadQueue } from './queue-control'
import { getExternalRequestSignal } from '../external-request-context'
import { sanitizeDiagnosticMessage } from '../domain-error'

interface RequestContext { signal?: AbortSignal; onActivity?: () => void; initializing?: boolean; httpStatus?: number; transportError?: { status?: number; code?: string; retryAfterMs?: number } }
interface AxiosRequest { signal?: AbortSignal; timeout?: number }
interface AxiosResponse { status: number; headers?: Record<string, string> }
interface AxiosError { code?: string; response?: AxiosResponse }
interface AxiosTransport {
  interceptors: {
    request: { use(handler: (config: AxiosRequest) => AxiosRequest): unknown }
    response: { use(success: (response: AxiosResponse) => AxiosResponse, failure: (error: AxiosError) => Promise<never>): unknown }
  }
}

const context = new AsyncLocalStorage<RequestContext>()
let installed = false
let xeapiReady: Promise<void> | null = null
let nextRequestAt = 0
let cooldownUntil = 0
export const DOWNLOAD_METADATA_TIMEOUT_MS = 30_000
const REQUEST_INTERVAL_MS = 250

/** File tasks keep their own signal, even when a source request stops waiting. */
export function withDownloadRequestContext<T>(signal: AbortSignal | undefined, action: () => Promise<T>, onActivity?: () => void): Promise<T> {
  return context.run({ signal, onActivity }, action)
}

function installTransportOptions() {
  if (installed) return
  // Keep transport cancellation scoped while retaining the SDK's encryption.
  const require = createRequire(import.meta.url)
  const sdkRequire = createRequire(require.resolve('@neteasecloudmusicapienhanced/api'))
  sdkDeviceId(sdkRequire)
  const transport = sdkRequire('axios').default as AxiosTransport
  transport.interceptors.request.use(config => {
    const active = context.getStore()
    if (active) { config.signal = active.signal; config.timeout = DOWNLOAD_METADATA_TIMEOUT_MS }
    return config
  })
  transport.interceptors.response.use(response => {
    const active = context.getStore()
    if (active) active.httpStatus = response.status
    return response
  }, async error => {
    const active = context.getStore()
    if (active) {
      active.transportError = { status: error.response?.status, code: error.code, retryAfterMs: retryAfterMs(error.response?.headers?.['retry-after']) }
    }
    throw error
  })
  // This SDK prints its rejected answer, including Set-Cookie arrays, directly.
  const log = console.log.bind(console)
  console.log = (...args: unknown[]) => {
    const active = context.getStore()
    if (!active || (args[0] !== '[ERR]' && !active.initializing)) return log(...args)
    const safe = JSON.stringify(args.map(value => value instanceof Error ? value.message : value), (key, value) => /^(?:cookie|set-cookie|authorization|token|password|secret|music_[ua]|sk|keyBlob|encryptKey|decryptKey|x-encr-sskey|x-encr-ssid)$/i.test(key) ? '[REDACTED]' : value)
    log('[网易云接口]', sanitizeDiagnosticMessage(safe))
  }
  installed = true
}

/** Only song_url_v1 uses XEAPI; metadata and login do not need its key. */
function ensureXeapiReady(): Promise<void> {
  if (xeapiReady) return xeapiReady
  const require = createRequire(import.meta.url)
  const sdkRequire = createRequire(require.resolve('@neteasecloudmusicapienhanced/api'))
  const { getXeapiPublicKey } = sdkRequire('./util/xeapiKey.js') as {
    getXeapiPublicKey(current: Record<string, unknown>, deviceId: string): Promise<{ sk?: string }>
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('网易云初始化超时'), { code: 'ETIMEDOUT' })), DOWNLOAD_METADATA_TIMEOUT_MS)
  xeapiReady = context.run({ signal: controller.signal, initializing: true }, async () => {
    const keyPath = join(tmpdir(), 'xeapi_public_key')
    let current: Record<string, unknown> = {}
    try {
      const saved = JSON.parse(readFileSync(keyPath, 'utf8'))
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) current = saved
    } catch { /* Cold container. */ }
    const key = await getXeapiPublicKey(current, sdkDeviceId(sdkRequire))
    controller.signal.throwIfAborted()
    if (!key.sk) throw new Error('网易云协议密钥尚未就绪')
    writeFileSync(keyPath, JSON.stringify(key), { mode: 0o600 })
  }).catch(error => {
    xeapiReady = null
    if (controller.signal.aborted) throw controller.signal.reason
    throw Object.assign(new Error('网易云接口初始化失败，请检查网络后重试'), { code: 'NETEASE_INITIALIZATION_FAILED', cause: error })
  }).finally(() => clearTimeout(timer))
  return xeapiReady
}

function sdkDeviceId(sdkRequire: ReturnType<typeof createRequire>): string {
  const sdkGlobal = globalThis as typeof globalThis & { deviceId?: string }
  if (!sdkGlobal.deviceId) {
    const { generateDeviceId } = sdkRequire('./util/index.js') as { generateDeviceId(): string }
    sdkGlobal.deviceId = generateDeviceId()
  }
  return sdkGlobal.deviceId
}

export async function controlledNeteaseRequest<T>(action: () => Promise<T>, endpoint = 'metadata'): Promise<T> {
  const parent = context.getStore()
  const parentSignal = parent ? parent.signal : getExternalRequestSignal()
  installTransportOptions()
  await waitForRequestSlot(parentSignal, parent?.onActivity, Boolean(parent))
  const controller = new AbortController()
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal
  const requestContext: RequestContext = { signal }
  const started = Date.now()
  const annotate = (message: string, properties: Record<string, unknown> = {}) => Object.assign(
    new Error(`${message}（接口 ${endpoint}，耗时 ${Date.now() - started} ms）`),
    { endpoint, durationMs: Date.now() - started, ...properties },
  )
  const timer = setTimeout(() => controller.abort(annotate('网易云请求超时', { code: 'ETIMEDOUT' })), DOWNLOAD_METADATA_TIMEOUT_MS)
  try {
    const result = await context.run(requestContext, () => abortable((async () => {
      if (endpoint === 'song_url_v1') await ensureXeapiReady()
      signal.throwIfAborted()
      return action()
    })(), signal))
    const response = result as { status?: number; body?: { code?: number } } | null
    if (Number(response?.status) >= 400 || [301, 401, 403, 429].includes(Number(response?.body?.code))) throw result
    return result
  } catch (error) {
    if (signal.aborted) throw signal.reason
    const response = error as { status?: number; body?: { code?: number; msg?: string; message?: string } } | null
    const httpStatus = requestContext.transportError?.status ?? requestContext.httpStatus
    const providerCode = Number(response?.body?.code || 0)
    const status = httpStatus && httpStatus >= 400 ? httpStatus : providerCode || Number(response?.status || 0)
    const statusDetails = { httpStatus, providerCode: providerCode || undefined }
    const message = response?.body?.msg || response?.body?.message || ''
    if ([301, 401].includes(status) || (status === 403 && /登录|未登录|cookie|认证|unauthori[sz]ed/i.test(message))) {
      throw annotate('网易云登录已失效，请更新 Cookie', { ...statusDetails, code: 'AUTHENTICATION_FAILED' })
    }
    if (status === 429) {
      const delay = Math.max(30_000, requestContext.transportError?.retryAfterMs ?? 0)
      cooldownUntil = Math.max(cooldownUntil, Date.now() + delay)
      if (parent) coolDownDownloadQueue(delay)
      throw annotate('网易云请求受限，请稍后重试（状态 429）', { ...statusDetails, retryAfterMs: delay, code: 'RATE_LIMITED' })
    }
    const code = requestContext.transportError?.code ?? (error as { code?: string } | null)?.code
    if (code === 'NETEASE_INITIALIZATION_FAILED') throw annotate('网易云接口初始化失败，请检查网络后重试', { code })
    if (code && !requestContext.transportError?.status) throw annotate('网易云连接失败', { code, ...statusDetails })
    if (status) {
      const label = httpStatus && httpStatus >= 400 ? `HTTP ${httpStatus}` : `业务状态 ${status}`
      throw annotate(`网易云服务请求失败（${label}）`, { ...statusDetails, code: 'NETEASE_REQUEST_FAILED' })
    }
    throw annotate('网易云接口请求失败', { code: 'NETEASE_REQUEST_FAILED' })
  } finally { clearTimeout(timer) }
}

async function waitForRequestSlot(signal?: AbortSignal, onActivity?: () => void, downloadScoped = false) {
  while (true) {
    signal?.throwIfAborted()
    const cooldown = downloadScoped ? getDownloadQueueControl().cooldownUntil : null
    const due = Math.max(nextRequestAt, cooldownUntil, cooldown ? Date.parse(cooldown) : 0)
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
