import { describe, expect, it } from 'vitest'
import { buildCachedTargetOrder } from './reorder-cache'

describe('buildCachedTargetOrder', () => {
  it('returns ordered rating keys when cache is complete', () => {
    const result = buildCachedTargetOrder(
      [11, 22, 33],
      new Map([
        [11, 'rk-1'],
        [22, 'rk-2'],
        [33, 'rk-3'],
      ]),
    )

    expect(result).toEqual(['rk-1', 'rk-2', 'rk-3'])
  })

  it('returns null when any cache entry is missing', () => {
    const result = buildCachedTargetOrder(
      [11, 22, 33],
      new Map([
        [11, 'rk-1'],
        [33, 'rk-3'],
      ]),
    )

    expect(result).toBeNull()
  })
})
