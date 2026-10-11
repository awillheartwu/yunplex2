import { afterEach, describe, expect, it, vi } from 'vitest'

const thread = vi.hoisted(() => ({ main: true, id: 0 }))
vi.mock('node:worker_threads', () => ({
  get isMainThread() { return thread.main },
  get threadId() { return thread.id },
}))
import { getProcessMemorySample } from '~~/server/lib/system-memory'

describe('process memory sampling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    Object.assign(thread, { main: true, id: 0 })
  })

  it('preserves the native byte values from one sample and marks main-thread scope', () => {
    const native = { rss: 983040123, heapUsed: 41943127, heapTotal: 47185999, external: 3145749, arrayBuffers: 65539 }
    const read = vi.spyOn(process, 'memoryUsage').mockReturnValue(native)
    vi.stubEnv('NODE_ENV', 'production')

    expect(getProcessMemorySample()).toEqual({
      memory: native,
      memoryContext: { mode: 'production', rssScope: 'process', detailsScope: 'thread', isMainThread: true, threadId: 0 },
    })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('identifies development worker samples without treating their heap as process-wide', () => {
    Object.assign(thread, { main: false, id: 4 })
    vi.stubEnv('NODE_ENV', 'development')
    expect(getProcessMemorySample().memoryContext).toEqual({
      mode: 'development', rssScope: 'process', detailsScope: 'thread', isMainThread: false, threadId: 4,
    })
  })

  it('does not assume a production mode when the environment is unspecified', () => {
    vi.stubEnv('NODE_ENV', '')
    expect(getProcessMemorySample().memoryContext.mode).toBe('unknown')
  })
})
