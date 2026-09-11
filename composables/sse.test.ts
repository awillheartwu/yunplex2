import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'vue'

class FakeEventSource extends EventTarget {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 2
  static instances: FakeEventSource[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn(() => { this.readyState = 2 })
  constructor(public url: string) { super(); FakeEventSource.instances.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  fail(state = 0) { this.readyState = state; this.onerror?.() }
  send(type: string, data = {}) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })) }
}

let subscriptions: Array<() => void> = []
let browser: EventTarget
let doc: EventTarget & { visibilityState: string }
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  FakeEventSource.instances = []
  browser = new EventTarget()
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', doc)
})
afterEach(() => {
  subscriptions.forEach(unsubscribe => unsubscribe())
  subscriptions = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('shared realtime lifecycle', () => {
  it('shares the connecting and natively reconnecting stream across subscribers', async () => {
    const { sseSubscribe, sseConnected } = await import('./sse')
    subscriptions.push(sseSubscribe('log', vi.fn()), sseSubscribe('stage-change', vi.fn()))
    expect(FakeEventSource.instances).toHaveLength(1)
    const stream = FakeEventSource.instances[0]!
    stream.open()
    expect(sseConnected.value).toBe(true)
    stream.fail()
    subscriptions.push(sseSubscribe('queue-update', vi.fn()))
    await vi.advanceTimersByTimeAsync(15000)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(stream.close).not.toHaveBeenCalled()
    stream.open()
    expect(sseConnected.value).toBe(true)
  })

  it('owns duplicate handler subscriptions independently and releases idempotently', async () => {
    const { sseSubscribe } = await import('./sse')
    const handler = vi.fn()
    const first = sseSubscribe('log', handler)
    const second = sseSubscribe('log', handler)
    subscriptions.push(first, second)
    first(); first()
    const stream = FakeEventSource.instances[0]!
    stream.send('log', { message: 'still subscribed' })
    expect(handler).toHaveBeenCalledExactlyOnceWith({ message: 'still subscribed' })
    expect(stream.close).not.toHaveBeenCalled()
    second()
    expect(stream.close).toHaveBeenCalledTimes(1)
  })

  it('refreshes snapshots on reconnect and foreground/online resume without opening extra streams', async () => {
    const { sseSubscribe } = await import('./sse')
    const refresh = vi.fn()
    subscriptions.push(sseSubscribe('resync', refresh))
    const stream = FakeEventSource.instances[0]!
    stream.open(); stream.fail(); stream.open()
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    browser.dispatchEvent(new Event('online'))
    expect(refresh).toHaveBeenCalledTimes(4)
    expect(FakeEventSource.instances).toHaveLength(1)
    subscriptions[0]!()
    browser.dispatchEvent(new Event('online'))
    expect(refresh).toHaveBeenCalledTimes(4)
  })

  it('retries a terminal stream once and cancels retry on final unmount', async () => {
    const { sseSubscribe, sseConnected } = await import('./sse')
    subscriptions.push(sseSubscribe('log', vi.fn()))
    const first = FakeEventSource.instances[0]!
    first.fail(2); first.fail(2)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakeEventSource.instances).toHaveLength(2)
    first.open() // An old connection cannot change current connection state.
    expect(sseConnected.value).toBe(false)
    FakeEventSource.instances[1]!.fail(2)
    subscriptions[0]!()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(15000)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('closes an apparently open stream on offline and waits for online before reconnecting', async () => {
    const navigator = { onLine: true }
    vi.stubGlobal('navigator', navigator)
    const { sseSubscribe, sseConnected } = await import('./sse')
    subscriptions.push(sseSubscribe('log', vi.fn()))
    const first = FakeEventSource.instances[0]!
    first.open()
    navigator.onLine = false
    browser.dispatchEvent(new Event('offline'))
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(sseConnected.value).toBe(false)
    subscriptions.push(sseSubscribe('queue-update', vi.fn()))
    await vi.advanceTimersByTimeAsync(15000)
    expect(FakeEventSource.instances).toHaveLength(1)
    navigator.onLine = true
    browser.dispatchEvent(new Event('online'))
    expect(FakeEventSource.instances).toHaveLength(2)
    FakeEventSource.instances[1]!.open()
    expect(sseConnected.value).toBe(true)
  })
})
