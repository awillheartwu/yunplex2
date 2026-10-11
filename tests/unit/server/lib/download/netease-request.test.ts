import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, initDb } from '~~/server/lib/db'
import { controlledNeteaseRequest, DOWNLOAD_METADATA_TIMEOUT_MS, withDownloadRequestContext } from '~~/server/lib/download/netease-request'

const require = createRequire(import.meta.url)
const transport = createRequire(require.resolve('NeteaseCloudMusicApi'))('axios').default as {
  (config: { url: string }): Promise<unknown>
  defaults: { adapter: unknown }
}
const originalAdapter = transport.defaults.adapter
let directory = '', sequence = 0
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-download-request-'))
  initDb(directory)
  vi.useFakeTimers()
  vi.setSystemTime(Date.now() + (++sequence) * 10 * 60_000)
})
afterEach(() => {
  transport.defaults.adapter = originalAdapter
  vi.useRealTimers()
  closeDb(); rmSync(directory, { recursive: true, force: true })
})

describe('download metadata transport', () => {
  it('paces concurrent requests and carries isolated cancellation signals into the SDK Axios transport', async () => {
    const calls: Array<{ signal: AbortSignal; timeout: number; started: number }> = []
    transport.defaults.adapter = async (config: { signal: AbortSignal; timeout: number }) => {
      calls.push({ ...config, started: Date.now() })
      return { data: {}, status: 200, headers: {}, config }
    }
    const controllers = [new AbortController(), new AbortController(), new AbortController()]
    const requests = controllers.map(controller => withDownloadRequestContext(controller.signal,
      () => controlledNeteaseRequest(() => transport({ url: 'https://fixture.invalid/metadata' }))))
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all(requests)
    expect(calls).toHaveLength(3)
    expect(calls.map(call => call.timeout)).toEqual([30_000, 30_000, 30_000])
    expect(calls[1]!.started - calls[0]!.started).toBeGreaterThanOrEqual(250)
    expect(calls[2]!.started - calls[1]!.started).toBeGreaterThanOrEqual(250)
    controllers[1]!.abort()
    expect(calls.map(call => call.signal.aborted)).toEqual([false, true, false])
  })

  it('aborts an active transport request and never starts a queued request after cancellation', async () => {
    const calls: AbortSignal[] = []
    transport.defaults.adapter = (config: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      calls.push(config.signal)
      config.signal.addEventListener('abort', () => reject(config.signal.reason), { once: true })
    })
    const active = new AbortController(), queued = new AbortController()
    const first = expect(withDownloadRequestContext(active.signal, () => controlledNeteaseRequest(() => transport({ url: 'https://fixture.invalid/active' })))).rejects.toThrow('cancel active')
    const second = expect(withDownloadRequestContext(queued.signal, () => controlledNeteaseRequest(() => transport({ url: 'https://fixture.invalid/queued' })))).rejects.toThrow('cancel queued')
    await vi.advanceTimersByTimeAsync(1)
    queued.abort(new Error('cancel queued')); active.abort(new Error('cancel active'))
    await vi.advanceTimersByTimeAsync(250)
    await Promise.all([first, second])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.aborted).toBe(true)
  })

  it('has a finite timeout and preserves HTTP status and Retry-After through SDK error wrapping', async () => {
    const controller = new AbortController()
    const timeout = expect(withDownloadRequestContext(controller.signal,
      () => controlledNeteaseRequest(() => new Promise<never>(() => undefined)))).rejects.toMatchObject({ code: 'ETIMEDOUT' })
    await vi.advanceTimersByTimeAsync(DOWNLOAD_METADATA_TIMEOUT_MS + 1)
    await timeout
    transport.defaults.adapter = async () => { throw { response: { status: 429, headers: { 'retry-after': '45' } } } }
    const limited = expect(withDownloadRequestContext(controller.signal, () => controlledNeteaseRequest(async () => {
      try { return await transport({ url: 'https://fixture.invalid/rate' }) }
      catch { throw { status: 502, body: { code: 502 } } }
    }))).rejects.toMatchObject({ httpStatus: 429, retryAfterMs: 45_000 })
    await vi.advanceTimersByTimeAsync(1000)
    await limited
  })
})
