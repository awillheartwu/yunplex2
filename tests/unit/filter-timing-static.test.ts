import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

function readProjectFile(path: string) {
  return readFileSync(resolve(root, path), 'utf-8')
}

function functionBody(source: string, name: string) {
  const start = source.indexOf(`function ${name}`)
  if (start === -1) return ''
  const open = source.indexOf('{', start)
  if (open === -1) return ''

  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') depth -= 1
    if (depth === 0) return source.slice(open + 1, i)
  }

  return ''
}

describe('filter timing wiring', () => {
  it('debounces source search query syncing and fetches', () => {
    const sourcePage = readProjectFile('composables/useSyncSourcesPage.ts')

    expect(sourcePage).toContain('createLatestAsyncGuard')
    expect(sourcePage).toContain('sourceFetchGuard.isLatest(token)')
    expect(functionBody(sourcePage, 'applySourceFilters')).toContain('sourceSearchDebounce.cancel()')
    expect(functionBody(sourcePage, 'applySourceFilters')).toContain('syncSourceFilterQuery()')
    expect(functionBody(sourcePage, 'onSourceSearchInput')).toContain('sourceSearchDebounce.run()')
    expect(functionBody(sourcePage, 'onSourceSearchInput')).not.toContain('syncSourceFilterQuery()')
  })

  it('debounces run history and task center failure searches without per-key route writes', () => {
    const runHistory = readProjectFile('composables/useRunHistory.ts')
    const taskCenter = readProjectFile('composables/useTaskCenterPage.ts')

    expect(runHistory).toContain('searchDebounce.cancel(); syncQuery(); void runs.fetch()')
    expect(taskCenter).toContain('failureSearchDebounce.cancel(); selectedFailures.value = new Set(); syncFailureQuery(); void failures.fetch()')
    expect(functionBody(runHistory, 'onSearch')).toContain('searchDebounce.run()')
    expect(functionBody(runHistory, 'onSearch')).not.toContain('syncQuery()')
    expect(functionBody(taskCenter, 'onFailureSearch')).toContain('failureSearchDebounce.run()')
    expect(functionBody(taskCenter, 'onFailureSearch')).not.toContain('syncFailureQuery()')
  })

  it('batches system log writes through the shared SSE connection', () => {
    const systemLogs = readProjectFile('composables/useSystemLogs.ts')

    expect(systemLogs).toContain('const pendingRealtimeLogs: LogEntry[] = []')
    expect(systemLogs).toContain('const realtimeBatch = useThrottleFn(flushRealtimeLogs, 80)')
    expect(systemLogs).toContain("sseSubscribe('log', enqueueRealtimeLog)")
    expect(systemLogs).not.toContain('new EventSource')
  })

  it('raf-throttles layout invalidation paths', () => {
    const filterBar = readProjectFile('components/common/FilterBar.vue')
    const dateRange = readProjectFile('components/common/DateRange.vue')
    const sourcePage = readProjectFile('composables/useSyncSourcesPage.ts')

    expect(filterBar).toContain('useRafThrottleFn(handleWindowChange)')
    expect(filterBar).toContain("window.addEventListener('resize', handleWindowChangeOnFrame)")
    expect(dateRange).toContain('useRafThrottleFn(handleViewportChange)')
    expect(dateRange).toContain("window.addEventListener('scroll', handleViewportChangeOnFrame, true)")
    expect(sourcePage).toContain('const throttledDragOver = useRafThrottleFn(onDragOver)')
    expect(sourcePage).toContain('const updateTableShellWidthOnFrame = useRafThrottleFn(updateTableShellWidth)')
    expect(sourcePage).toContain('const hideHoverOnFrame = useRafThrottleFn(() => { hoverCard.value = null })')
  })
})
