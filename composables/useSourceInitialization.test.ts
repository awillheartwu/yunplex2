import { describe, expect, it, vi } from 'vitest'
import { useSourceInitialization, type SourceInitializationApi } from './useSourceInitialization'

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'initialization-1', sourceId: 'source-1', runId: null, followUpRunId: null, trigger: 'user', status: 'awaiting_review',
    ruleVersion: 1, rulesCompatible: true, requestId: null, requestStatus: null, neteaseCursor: null, plexFingerprint: null,
    totalItems: 1, preservedItems: 0, strongItems: 0, highConfidenceItems: 1, possibleItems: 0, ambiguousItems: 0,
    unmatchedItems: 0, adoptItems: 0, downloadItems: 1, deferredItems: 0, conflictItems: 0, summary: '', error: null,
    createdAt: '', startedAt: null, analyzedAt: null, completedAt: null, updatedAt: '', ...overrides,
  }
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    initializationId: 'initialization-1', neteaseSongId: 42, position: 0, occurrenceCount: 1, title: '测试歌曲', artists: ['测试艺人'],
    album: '测试专辑', trackNumber: null, durationMs: 180000, tier: 'high_confidence',
    candidate: { ratingKey: 'plex-42', title: '测试歌曲', artist: '测试艺人', album: '测试专辑', durationMs: 180000, trackNumber: null, filePath: '/music/42.flac' },
    candidates: [], evidence: { rule: 'strict_local_metadata' }, expectedBindingUpdatedAt: null, decisionStatus: 'proposed',
    kind: 'actionable', decision: 'download', allowedDecisions: ['download', 'defer'], canSearch: true, unavailableReason: null, ...overrides,
  }
}

type MockApi = SourceInitializationApi & { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> }

function apiFor(data: { initialization?: Record<string, unknown> | null; items?: unknown[] } = {}): MockApi {
  const api = {
    get: vi.fn(async (path: string) => path.endsWith('/items')
      ? { items: data.items || [item()], total: data.items?.length || 1, page: 1, pageSize: 50 }
      : { applicable: true, initialization: data.initialization || summary(), downloadConcurrency: 3, convergenceQueueDepth: 2 }),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
  }
  return api as unknown as MockApi
}

describe('useSourceInitialization', () => {
  it('ignores stale snapshot responses and keeps the latest initialization', async () => {
    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    const first = new Promise(resolve => { resolveFirst = resolve })
    const second = new Promise(resolve => { resolveSecond = resolve })
    const api = apiFor()
    api.get.mockImplementation((path: string) => path.endsWith('/items')
      ? Promise.resolve({ items: [], total: 0, page: 1, pageSize: 50 })
      : first)
    const state = useSourceInitialization({ sourceId: 'source-1', api, registerLifecycle: false })
    const firstLoad = state.load()
    api.get.mockImplementation((path: string) => path.endsWith('/items')
      ? Promise.resolve({ items: [], total: 0, page: 1, pageSize: 50 })
      : second)
    const secondLoad = state.load()
    resolveSecond({ applicable: true, initialization: summary({ id: 'latest' }), downloadConcurrency: 4, convergenceQueueDepth: 8 })
    await secondLoad
    resolveFirst({ applicable: true, initialization: summary({ id: 'stale' }), downloadConcurrency: 1, convergenceQueueDepth: 1 })
    await firstLoad
    expect(state.initialization.value?.id).toBe('latest')
    expect(state.downloadConcurrency.value).toBe(4)
    expect(state.queueDepth.value).toBe(8)
  })

  it('debounces search, reports page errors, and clears pending timers on dispose', async () => {
    vi.useFakeTimers()
    const api = apiFor()
    const state = useSourceInitialization({ sourceId: 'source-1', api, registerLifecycle: false, searchDelayMs: 100 })
    await state.load()
    api.get.mockClear()
    state.onSearch('old')
    state.onSearch('new')
    vi.advanceTimersByTime(99)
    expect(api.get).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(api.get).toHaveBeenLastCalledWith('/playlist-sources/source-1/initialization/items', expect.objectContaining({ search: 'new', page: '1' }))

    api.get.mockRejectedValueOnce(new Error('分页不可用'))
    await state.reloadItems(2)
    expect(state.itemsError.value).toBe('分页不可用')

    api.get.mockClear()
    state.onSearch('cancelled')
    state.dispose()
    vi.advanceTimersByTime(100)
    expect(api.get).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('uses server capabilities for decisions and sends initialization ids to restart and commit', async () => {
    const api = apiFor({ items: [item({ canSearch: false, unavailableReason: '当前审核项不可搜索' })] })
    const changed = vi.fn()
    const state = useSourceInitialization({ sourceId: 'source-1', api, registerLifecycle: false, onChanged: changed })
    await state.load()

    await state.decideOne(42, 'adopt')
    expect(api.put).not.toHaveBeenCalled()
    expect(state.error.value).toContain('不允许')

    await state.searchPlex(state.result.value.items[0]!)
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(state.error.value).toContain('当前审核项不可搜索')

    await state.restart()
    expect(api.post).toHaveBeenCalledWith('/playlist-sources/source-1/initialization/restart', { initializationId: 'initialization-1' })
    await state.commit()
    expect(api.post).toHaveBeenCalledWith('/playlist-sources/source-1/initialization/commit', { initializationId: 'initialization-1' })
    expect(changed).toHaveBeenCalled()
  })

  it('marks a pending request as waiting instead of running', async () => {
    const api = apiFor({ initialization: summary({ status: 'pending', requestStatus: 'pending' }) })
    const state = useSourceInitialization({ sourceId: 'source-1', api, registerLifecycle: false })
    await state.load()
    expect(state.isWaitingAnalysis.value).toBe(true)
    expect(state.isAnalyzing.value).toBe(false)
  })

  it('keeps an incompatible draft readable while disabling edits and commit', async () => {
    const api = apiFor({ initialization: summary({ rulesCompatible: false }), items: [item({ allowedDecisions: [], canSearch: false, unavailableReason: '方案不可编辑，请重新分析' })] })
    const state = useSourceInitialization({ sourceId: 'source-1', api, registerLifecycle: false })
    await state.load()
    expect(state.canReview.value).toBe(true)
    expect(state.result.value.items).toHaveLength(1)
    expect(state.isEditable.value).toBe(false)
    await state.decideOne(42, 'download')
    await state.commit()
    expect(api.put).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })
})
