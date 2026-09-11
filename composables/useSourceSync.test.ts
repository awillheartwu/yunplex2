import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSourceSync } from './useSourceSync'

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), unsubscribe: vi.fn(),
  unmount: null as null | (() => void),
  event: null as null | ((data: Record<string, unknown>) => void),
}))
vi.mock('vue', async () => ({
  ...await vi.importActual('vue'),
  onMounted: (callback: () => void) => callback(),
  onUnmounted: (callback: () => void) => { mocks.unmount = callback },
}))
vi.mock('./sse', () => ({
  sseConnected: { value: true },
  sseSubscribe: (_type: string, callback: typeof mocks.event) => { mocks.event = callback; return mocks.unsubscribe },
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('useApi', () => ({ get: mocks.get, post: mocks.post }))
  mocks.post.mockResolvedValue({ triggered: true, batchId: 'batch', results: [{ sourceId: 'source', status: 'accepted', kind: 'convergence', requestId: 'request' }] })
})
afterEach(() => { mocks.unmount?.(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('source request presentation', () => {
  it('distinguishes accepted and running work and ignores unrelated idle events', async () => {
    mocks.get.mockResolvedValue({ id: 'request', sourceId: 'source', kind: 'convergence', status: 'pending', error: null })
    const state = useSourceSync()
    await state.syncSource('source')
    expect(state.syncingSourceId.value).toBeNull()
    mocks.get.mockResolvedValue({ id: 'request', sourceId: 'source', kind: 'convergence', status: 'running', error: null })
    await vi.advanceTimersByTimeAsync(2500)
    expect(state.syncingSourceId.value).toBe('source')
    mocks.event?.({ stage: 'idle', sourceId: 'unrelated' })
    expect(state.syncingSourceId.value).toBe('source')
    expect(mocks.get).toHaveBeenCalledTimes(2)
    mocks.get.mockResolvedValue({ id: 'request', sourceId: 'source', kind: 'convergence', status: 'failed', error: 'request failed' })
    await vi.advanceTimersByTimeAsync(2500)
    expect(state.syncingSourceId.value).toBeNull()
    expect(state.error.value).toBe('request failed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not label analysis as synchronization', async () => {
    mocks.get.mockResolvedValue({ id: 'request', sourceId: 'source', kind: 'analysis', status: 'running', error: null })
    const state = useSourceSync()
    await state.syncSource('source')
    expect(state.syncingSourceId.value).toBeNull()
    expect(state.requestState.value?.kind).toBe('analysis')
  })

  it('does not recreate a timer when an accepted response arrives after unmount', async () => {
    let release!: (value: unknown) => void
    mocks.post.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const state = useSourceSync()
    const pending = state.syncSource('source')
    mocks.unmount?.()
    release({ triggered: true, batchId: 'batch', results: [{ sourceId: 'source', status: 'accepted', requestId: 'request' }] })
    await pending
    expect(mocks.get).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.unsubscribe).toHaveBeenCalled()
  })
})
