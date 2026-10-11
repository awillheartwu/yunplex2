import { describe, expect, it } from 'vitest'
import { detectChanges } from '~~/server/lib/sync/change-detection'

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

  it('forces full compare when Plex drift is detected while Netease is unchanged', () => {
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
      plexDriftDetected: true,
    })

    expect(result.skipEntirely).toBe(false)
    expect(result.needFullCompare).toBe(true)
    expect(result.plexDriftDetected).toBe(true)
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

  it('recognises a pure addition even though the full arrays differ', () => {
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
      currentIdOrder: [1, 2, 3, 4],
      trackIdSnapshot: JSON.stringify([1, 2, 3]),
    })

    expect(result.isPureAddition).toBe(true)
    expect(result.canIncremental).toBe(true)
    expect(result.needFullCompare).toBe(false)
  })

  it('recognises a pure deletion when the remaining order is unchanged', () => {
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
      currentIdOrder: [1, 3],
      trackIdSnapshot: JSON.stringify([1, 2, 3]),
    })

    expect(result.isPureDeletion).toBe(true)
    expect(result.canIncremental).toBe(true)
    expect(result.needFullCompare).toBe(false)
  })

  it('does not call an addition pure when existing tracks were also reordered', () => {
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
      currentIdOrder: [2, 1, 3, 4],
      trackIdSnapshot: JSON.stringify([1, 2, 3]),
    })

    expect(result.isPureAddition).toBe(false)
    expect(result.canIncremental).toBe(false)
    expect(result.needFullCompare).toBe(true)
  })
})
