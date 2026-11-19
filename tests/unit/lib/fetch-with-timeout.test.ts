import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from '~~/lib/fetch-with-timeout'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('aborts a body that stalls after headers arrived and removes the deadline', async () => {
  vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => Promise.resolve({
    json: () => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error('body aborted')))),
  })))
  const pending = fetchWithTimeout('/slow', {}, 100, response => response.json())
  const assertion = expect(pending).rejects.toThrow('请求超时或已取消')
  await vi.advanceTimersByTimeAsync(100)
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})

it('relays cancellation and removes listeners after success', async () => {
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  let requestSignal!: AbortSignal
  vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => { requestSignal = options.signal!; return Promise.resolve(Response.json({ ok: true })) }))
  expect(await fetchWithTimeout('/ok', { signal: controller.signal }, 100, response => response.json())).toEqual({ ok: true })
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(vi.getTimerCount()).toBe(0)
  controller.abort()
  expect(requestSignal.aborted).toBe(false)
})

it('cancels an in-flight request when the owning page leaves', async () => {
  const controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error('aborted'))))))
  const pending = fetchWithTimeout('/slow', { signal: controller.signal }, 100, response => response.json())
  const assertion = expect(pending).rejects.toThrow('请求超时或已取消')
  controller.abort()
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})
