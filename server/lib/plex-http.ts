import { randomUUID } from 'node:crypto'
import { version } from '../../package.json'
import type { PlexConfig } from './config/types'
import { getExternalRequestSignal } from './external-request-context'

const clientIdentifier = randomUUID()
const REQUEST_TIMEOUT_MS = 30_000
const PMS_API_VERSION = '1.0'
type PlexMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface PlexResponse {
  data: Record<string, unknown>
  headers: Headers
  status: number
}

export function createPlexHttpClient(config: PlexConfig) {
  const base = new URL(config.server.includes('://') ? config.server : `http://${config.server}`)
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Plex 地址必须使用 HTTP 或 HTTPS')
  base.port = String(config.port)
  base.search = ''
  base.hash = ''
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  const headers = {
    Accept: 'application/json',
    'X-Plex-Token': config.token,
    'X-Plex-Client-Identifier': clientIdentifier,
    'X-Plex-Product': 'YunPlex',
    'X-Plex-Version': version,
    'X-Plex-Pms-Api-Version': PMS_API_VERSION,
  }

  async function request(path: string, method: PlexMethod = 'GET'): Promise<PlexResponse> {
    const url = new URL(path.replace(/^\//, ''), base)
    const parentSignal = getExternalRequestSignal()
    parentSignal?.throwIfAborted()
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout
    const started = Date.now()
    try {
      // Writes are issued once; their uncertain outcome is checked by reconciliation.
      const response = await fetch(url, { method, headers, signal, redirect: 'error' })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw Object.assign(new Error(`Plex ${method} ${url.pathname} 请求失败（HTTP ${response.status}，耗时 ${Date.now() - started} ms）`), {
          provider: 'plex', status: response.status, httpStatus: response.status,
          code: [401, 403].includes(response.status) ? 'plex_authentication_failed' : undefined,
        })
      }
      const text = await response.text()
      const body = text.trim()
      // Refresh and playlist mutation endpoints may acknowledge with empty/HTML bodies.
      const isJson = response.headers.get('content-type')?.includes('json') || body.startsWith('{')
      if (body && !isJson && method === 'GET') throw new SyntaxError('Expected JSON')
      const data = body && isJson ? JSON.parse(body) as Record<string, unknown> : {}
      return { data, headers: response.headers, status: response.status }
    } catch (error) {
      if (parentSignal?.aborted) throw parentSignal.reason
      if (timeout.aborted) {
        throw Object.assign(new Error(`Plex ${method} ${url.pathname} 请求超时（耗时 ${Date.now() - started} ms）`), { code: 'ETIMEDOUT' })
      }
      if (error instanceof SyntaxError) throw new Error(`Plex ${method} ${url.pathname} 未返回有效 JSON`, { cause: error })
      const cause = (error as { cause?: { code?: string } } | null)?.cause
      if ((error as { httpStatus?: number } | null)?.httpStatus) throw error
      const code = cause?.code ?? (error as { code?: string } | null)?.code
      throw Object.assign(new Error(`Plex ${method} ${url.pathname} 连接失败（${code || '网络错误'}，耗时 ${Date.now() - started} ms）`, { cause: error }), { code })
    }
  }

  return {
    request,
    async openEventStream(signal: AbortSignal): Promise<Response> {
      const url = new URL(':/eventsource/notifications?filters=activity,timeline', base)
      const response = await fetch(url, {
        headers: { ...headers, Accept: 'text/event-stream' }, signal, redirect: 'error',
      })
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel().catch(() => undefined)
        throw Object.assign(new Error(`Plex 事件订阅失败（HTTP ${response.status}）`), {
          provider: 'plex', httpStatus: response.status,
          code: [401, 403].includes(response.status) ? 'plex_authentication_failed' : undefined,
        })
      }
      return response
    },
    query: async (path: string) => (await request(path)).data,
    postQuery: async (path: string) => (await request(path, 'POST')).data,
    putQuery: async (path: string) => (await request(path, 'PUT')).data,
    deleteQuery: async (path: string) => (await request(path, 'DELETE')).data,
  }
}
