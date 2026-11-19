import { describe, expect, it, vi } from 'vitest'
import type { TaskRunSummary } from '~~/server/lib/job/types'
import { useRuns, type RunsApi, type RunsPage } from '~~/composables/useRuns'

function run(id: string): TaskRunSummary {
  return {
    id, type: 'sync', trigger: 'user', startedAt: '2026-10-09T02:00:00.000Z', finishedAt: null,
    status: 'success', durationMs: 0, summary: id, source: '测试来源', totalSongs: 0, successSongs: 0,
    failedSongs: 0, skippedSongs: 0, removedSongs: 0, warnings: 0, dryRun: false,
    awaitingSourceSync: false, sourceRequestStatus: null,
  }
}

function page(ids: string[], total: number): RunsPage {
  return { items: ids.map(run), total, earliestDate: '2026-09-01' }
}

type MockApi = RunsApi & { get: ReturnType<typeof vi.fn> }

function apiWith(): MockApi {
  return { get: vi.fn() } as unknown as MockApi
}

function lastCall(api: MockApi) {
  return api.get.mock.calls.at(-1) as [string, Record<string, string>]
}

describe('useRuns pagination', () => {
  it('loads the first page with the API limit/offset contract', async () => {
    const api = apiWith()
    api.get.mockResolvedValueOnce(page(['a', 'b'], 5))
    const runs = useRuns({}, { api, pageSize: 2 })

    await runs.fetch()

    expect(lastCall(api)).toEqual(['/runs', expect.objectContaining({ limit: '2', offset: '0' })])
    expect(runs.items.value.map(item => item.id)).toEqual(['a', 'b'])
    expect(runs.total.value).toBe(5)
    expect(runs.pageCount.value).toBe(3)
    expect(runs.page.value).toBe(1)
  })

  it('requests the offset of the page a user picks', async () => {
    const api = apiWith()
    api.get.mockResolvedValueOnce(page(['a', 'b'], 5))
    const runs = useRuns({}, { api, pageSize: 2 })
    await runs.fetch()

    api.get.mockResolvedValueOnce(page(['e'], 5))
    await runs.goToPage(3)

    expect(lastCall(api)[1]).toMatchObject({ limit: '2', offset: '4' })
    expect(runs.page.value).toBe(3)
    expect(runs.items.value.map(item => item.id)).toEqual(['e'])
  })

  it('lets the latest page request win over an older response', async () => {
    let resolveFirst!: (value: RunsPage) => void
    let resolveSecond!: (value: RunsPage) => void
    const api = apiWith()
    api.get
      .mockImplementationOnce(() => new Promise<RunsPage>(resolve => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise<RunsPage>(resolve => { resolveSecond = resolve }))
    const runs = useRuns({}, { api, pageSize: 2 })

    const first = runs.goToPage(2)
    const second = runs.goToPage(3)
    resolveSecond(page(['latest'], 5))
    await second
    resolveFirst(page(['stale'], 5))
    await first

    expect(runs.page.value).toBe(3)
    expect(runs.items.value.map(item => item.id)).toEqual(['latest'])
  })

  it('keeps the old page and rows when the next page fails', async () => {
    const api = apiWith()
    api.get.mockResolvedValueOnce(page(['b'], 5))
    const runs = useRuns({}, { api, pageSize: 2 })
    await runs.goToPage(2)

    api.get.mockRejectedValueOnce(new Error('取数失败'))
    await runs.goToPage(3)

    expect(runs.page.value).toBe(2)
    expect(runs.items.value.map(item => item.id)).toEqual(['b'])
    expect(runs.error.value).toBe('取数失败')
    expect(runs.loading.value).toBe(false)
  })

  it('clamps to the last valid page when the result set shrinks', async () => {
    const api = apiWith()
    api.get.mockResolvedValueOnce(page(['a', 'b'], 5))
    const runs = useRuns({}, { api, pageSize: 2 })
    await runs.fetch()
    api.get.mockResolvedValueOnce(page(['e'], 5))
    await runs.goToPage(3)

    api.get.mockResolvedValueOnce(page([], 3)).mockResolvedValueOnce(page(['c'], 3))
    await runs.fetch()

    expect(api.get.mock.calls.map(call => (call[1] as Record<string, string>).offset)).toEqual(['0', '4', '4', '2'])
    expect(runs.page.value).toBe(2)
    expect(runs.items.value.map(item => item.id)).toEqual(['c'])
  })

  it('restarts at page 1 when filters change and keeps the page on refresh', async () => {
    const api = apiWith()
    api.get.mockResolvedValueOnce(page(['a', 'b'], 5))
    const runs = useRuns({}, { api, pageSize: 2 })
    await runs.fetch()
    api.get.mockResolvedValueOnce(page(['c', 'd'], 5))
    await runs.goToPage(2)

    api.get.mockResolvedValueOnce(page(['c', 'd'], 5))
    await runs.fetch()
    expect(lastCall(api)[1]).toMatchObject({ offset: '2' })
    expect(runs.page.value).toBe(2)

    runs.filter.value = { status: 'failed', search: '专辑' }
    api.get.mockResolvedValueOnce(page(['x'], 1))
    await runs.fetch()
    expect(lastCall(api)[1]).toMatchObject({ offset: '0', status: 'failed', search: '专辑' })
    expect(runs.page.value).toBe(1)
    expect(runs.items.value.map(item => item.id)).toEqual(['x'])
  })

  it('reports failures without dropping the page that is already loaded', async () => {
    const api = apiWith()
    api.get.mockRejectedValueOnce(new Error('服务不可用'))
    const runs = useRuns({}, { api, pageSize: 2 })

    await runs.fetch()

    expect(runs.error.value).toBe('服务不可用')
    expect(runs.page.value).toBe(1)
    expect(runs.items.value).toEqual([])
  })
})
