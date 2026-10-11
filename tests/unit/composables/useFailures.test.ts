import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFailures } from '~~/composables/useFailures'

afterEach(() => vi.unstubAllGlobals())

describe('failure list pagination', () => {
  it('preserves a failed page, clamps after resolution, and resets for new filters', async () => {
    const get = vi.fn()
    vi.stubGlobal('useApi', () => ({ get }))
    const failures = useFailures()
    get.mockResolvedValueOnce({ items: [{ id: 'first' }], total: 120 })
    await failures.fetch()
    get.mockResolvedValueOnce({ items: [{ id: 'second' }], total: 120 })
    await failures.goToPage(2)
    expect(get.mock.calls.at(-1)?.[1].offset).toBe('50')
    get.mockRejectedValueOnce(new Error('offline'))
    await failures.goToPage(3)
    expect(failures.page.value).toBe(2)
    expect(failures.items.value[0]?.id).toBe('second')
    expect(failures.error.value).toBe('offline')
    get.mockResolvedValueOnce({ items: [], total: 1 }).mockResolvedValueOnce({ items: [{ id: 'remaining' }], total: 1 })
    await failures.fetch()
    expect(failures.page.value).toBe(1)
    expect(failures.items.value[0]?.id).toBe('remaining')
    failures.filter.value.sourceId = 'new-source'
    get.mockResolvedValueOnce({ items: [], total: 0 })
    await failures.fetch()
    expect(get.mock.calls.at(-1)?.[1]).toMatchObject({ offset: '0', sourceId: 'new-source' })
    expect(failures.error.value).toBe('')
  })
})
