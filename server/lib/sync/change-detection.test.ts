import { describe, expect, it } from 'vitest'
import { detectChanges } from './change-detection'

describe('detectChanges', () => {
  it('skips entirely when netease update time is unchanged', () => {
    const result = detectChanges({
      isAlbum: false,
      trackUpdateTime: 100,
      lastTrackUpdateTime: 100,
      manualForce: false,
      dryRun: false,
      consecutiveSkips: 0,
      fullCompareAfterSkips: 5,
      fullCompareAfterDays: 7,
      lastFullCompareAt: null,
      currentIdOrder: [1, 2, 3],
      trackIdSnapshot: JSON.stringify([1, 2, 3]),
    })

    expect(result.skipEntirely).toBe(true)
    expect(result.needFullCompare).toBe(false)
  })

  it('marks pure reorder as incremental when order only changes', () => {
    const result = detectChanges({
      isAlbum: false,
      trackUpdateTime: 200,
      lastTrackUpdateTime: 100,
      manualForce: false,
      dryRun: false,
      consecutiveSkips: 0,
      fullCompareAfterSkips: 5,
      fullCompareAfterDays: 7,
      lastFullCompareAt: null,
      currentIdOrder: [2, 1, 3],
      trackIdSnapshot: JSON.stringify([1, 2, 3]),
    })

    expect(result.isPureReorder).toBe(true)
    expect(result.needFullCompare).toBe(false)
    expect(result.skipEntirely).toBe(false)
  })

  it('forces full compare when manual force is enabled', () => {
    const result = detectChanges({
      isAlbum: false,
      trackUpdateTime: 200,
      lastTrackUpdateTime: 100,
      manualForce: true,
      dryRun: false,
      consecutiveSkips: 0,
      fullCompareAfterSkips: 5,
      fullCompareAfterDays: 7,
      lastFullCompareAt: null,
      currentIdOrder: [2, 1, 3],
      trackIdSnapshot: JSON.stringify([1, 2, 3]),
    })

    expect(result.needFullCompare).toBe(true)
  })

  it('auto-forces full compare after too many skips', () => {
    const result = detectChanges({
      isAlbum: false,
      trackUpdateTime: 200,
      lastTrackUpdateTime: 100,
      manualForce: false,
      dryRun: false,
      consecutiveSkips: 5,
      fullCompareAfterSkips: 5,
      fullCompareAfterDays: 7,
      lastFullCompareAt: null,
      currentIdOrder: [1, 2, 3, 4],
      trackIdSnapshot: JSON.stringify([1, 2, 3]),
    })

    expect(result.autoForce).toBe(true)
    expect(result.needFullCompare).toBe(true)
  })
})
