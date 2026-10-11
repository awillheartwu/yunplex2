import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry, LogLevel } from '~~/server/lib/log/types'
import { useSystemLogs, type LogsApi, type LogsPage } from '~~/composables/useSystemLogs'

afterEach(() => { vi.useRealTimers() })

function entry(id: string, level: LogLevel = 'info'): LogEntry {
  return { id, timestamp: '2026-10-09T02:00:00.000Z', level, message: id }
}

function page(ids: string[], total: number): LogsPage {
  return { items: ids.map(id => entry(id)), total }
}

type MockApi = LogsApi & { get: ReturnType<typeof vi.fn> }

function logsWith(pageSize = 2) {
  const api = { get: vi.fn() } as unknown as MockApi
  const logs = useSystemLogs({ api, pageSize, registerLifecycle: false })
  return { api, logs }
}

function lastCall(api: MockApi) {
  return api.get.mock.calls.at(-1) as [string, Record<string, string>]
}

async function live(logs: ReturnType<typeof logsWith>['logs'], payload: LogEntry) {
  logs.receiveRealtimeLog(payload as unknown as Record<string, unknown>)
  await vi.advanceTimersByTimeAsync(90)
}

describe('useSystemLogs pagination', () => {
  it('loads the first page with the API limit/offset contract', async () => {
    const api = { get: vi.fn() } as unknown as MockApi
    api.get.mockResolvedValueOnce(page(['a', 'b'], 6))
    const logs = useSystemLogs({ api, pageSize: 2, registerLifecycle: false })

    await logs.fetchLogs()

    expect(lastCall(api)).toEqual(['/logs', expect.objectContaining({ limit: '2', offset: '0' })])
    expect(logs.logs.value.map(item => item.id)).toEqual(['a', 'b'])
    expect(logs.page.value).toBe(1)
    expect(logs.pageCount.value).toBe(3)
  })

  it('keeps live logs bounded to the first page', async () => {
    vi.useFakeTimers()
    const { api, logs } = logsWith(2)
    api.get.mockResolvedValueOnce(page(['old-1', 'old-2'], 2))
    await logs.fetchLogs()

    await live(logs, entry('live-1'))
    await live(logs, entry('live-2'))
    await live(logs, entry('live-3'))

    expect(logs.logs.value.map(item => item.id)).toEqual(['live-3', 'live-2'])
    expect(logs.logs.value).toHaveLength(2)
    expect(logs.total.value).toBe(5)
    expect(logs.pendingCount.value).toBe(0)
  })

  it('counts new logs instead of rewriting a history page', async () => {
    vi.useFakeTimers()
    const { api, logs } = logsWith(2)
    api.get.mockResolvedValueOnce(page(['a', 'b'], 6))
    await logs.fetchLogs()
    api.get.mockResolvedValueOnce(page(['c', 'd'], 6))
    await logs.goToPage(2)

    await live(logs, entry('live-1'))
    await live(logs, entry('live-2'))

    expect(logs.logs.value.map(item => item.id)).toEqual(['c', 'd'])
    expect(logs.pendingCount.value).toBe(2)
    expect(logs.total.value).toBe(8)

    api.get.mockResolvedValueOnce(page(['live-2', 'live-1'], 8))
    await logs.showLatest()

    expect(lastCall(api)[1]).toMatchObject({ offset: '0' })
    expect(logs.page.value).toBe(1)
    expect(logs.pendingCount.value).toBe(0)
    expect(logs.logs.value.map(item => item.id)).toEqual(['live-2', 'live-1'])
  })

  it('ignores live logs that do not match the active level filter', async () => {
    vi.useFakeTimers()
    const { api, logs } = logsWith(2)
    api.get.mockResolvedValueOnce(page(['a'], 1))
    await logs.fetchLogs()
    api.get.mockResolvedValueOnce(page([], 0))
    await logs.setFilter('error')

    await live(logs, entry('info-noise', 'info'))
    await live(logs, entry('error-1', 'error'))

    expect(logs.logs.value.map(item => item.id)).toEqual(['error-1'])
  })

  it('restarts at page 1 for a level filter and keeps the page on refresh', async () => {
    const { api, logs } = logsWith(2)
    api.get.mockResolvedValueOnce(page(['a', 'b'], 6))
    await logs.fetchLogs()
    api.get.mockResolvedValueOnce(page(['c', 'd'], 6))
    await logs.goToPage(2)

    api.get.mockResolvedValueOnce(page(['c', 'd'], 6))
    await logs.fetchLogs()
    expect(lastCall(api)[1]).toMatchObject({ offset: '2' })
    expect(logs.page.value).toBe(2)

    api.get.mockResolvedValueOnce(page(['e'], 1))
    await logs.setFilter('error')
    expect(logs.page.value).toBe(1)
    expect(lastCall(api)[1]).toMatchObject({ offset: '0', level: 'error' })
    expect(logs.logs.value.map(item => item.id)).toEqual(['e'])
  })

  it('keeps the visible page and rows when a page request fails', async () => {
    const { api, logs } = logsWith(2)
    api.get.mockResolvedValueOnce(page(['a', 'b'], 6))
    await logs.fetchLogs()

    api.get.mockRejectedValueOnce(new Error('日志服务不可用'))
    await logs.goToPage(2)

    expect(logs.page.value).toBe(1)
    expect(logs.logs.value.map(item => item.id)).toEqual(['a', 'b'])
    expect(logs.error.value).toBe('日志服务不可用')
    expect(logs.loading.value).toBe(false)
  })

  it('clamps to the last valid page when retention shrinks the log set', async () => {
    const { api, logs } = logsWith(2)
    api.get.mockResolvedValueOnce(page(['a', 'b'], 6))
    await logs.fetchLogs()
    api.get.mockResolvedValueOnce(page(['e', 'f'], 6))
    await logs.goToPage(3)

    api.get.mockResolvedValueOnce(page([], 2)).mockResolvedValueOnce(page(['a', 'b'], 2))
    await logs.fetchLogs()

    expect(api.get.mock.calls.map(call => (call[1] as Record<string, string>).offset)).toEqual(['0', '4', '4', '0'])
    expect(logs.page.value).toBe(1)
    expect(logs.logs.value.map(item => item.id)).toEqual(['a', 'b'])
  })
})

describe('live logs during page requests', () => {
  it('deduplicates an event also contained in the in-flight first-page snapshot', async () => {
    vi.useFakeTimers()
    const { api, logs } = logsWith(2)
    let resolve!: (value: LogsPage) => void
    api.get.mockImplementationOnce(() => new Promise<LogsPage>(done => { resolve = done }))
    const request = logs.fetchLogs()
    await live(logs, entry('new'))
    resolve(page(['new', 'old'], 2))
    await request
    expect(logs.logs.value.map(item => item.id)).toEqual(['new', 'old'])
    expect(logs.total.value).toBe(2)
  })

  it('keeps historical rows and the new-log notice after a failed return to latest', async () => {
    vi.useFakeTimers()
    const { api, logs } = logsWith(2)
    api.get.mockResolvedValueOnce(page(['a', 'b'], 6))
    await logs.fetchLogs()
    api.get.mockResolvedValueOnce(page(['c', 'd'], 6))
    await logs.goToPage(2)
    await live(logs, entry('new'))
    api.get.mockRejectedValueOnce(new Error('offline'))
    await logs.showLatest()
    expect(logs.page.value).toBe(2)
    expect(logs.pendingCount.value).toBe(1)
    expect(logs.logs.value.map(item => item.id)).toEqual(['c', 'd'])
  })

  it('ignores a stale page response after changing the filter', async () => {
    const { api, logs } = logsWith(2)
    let resolve!: (value: LogsPage) => void
    api.get.mockImplementationOnce(() => new Promise<LogsPage>(done => { resolve = done }))
    const old = logs.fetchLogs()
    api.get.mockResolvedValueOnce({ items: [entry('error', 'error')], total: 1 })
    await logs.setFilter('error')
    resolve(page(['info'], 1))
    await old
    expect(logs.logs.value.map(item => item.id)).toEqual(['error'])
  })
})
