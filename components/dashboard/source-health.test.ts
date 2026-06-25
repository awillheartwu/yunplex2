import { describe, expect, it } from 'vitest'
import {
  getDashboardSourceHealthLegend,
  getDashboardSourceHealthPercent,
  getDashboardSourceHealthWidth,
} from './source-health'

describe('dashboard source health helpers', () => {
  it('returns safe zero values when there is no total', () => {
    expect(getDashboardSourceHealthPercent(3, 0)).toBe('0%')
    expect(getDashboardSourceHealthWidth(3, 0)).toBe('0%')
  })

  it('builds rounded legend percentages from the summary', () => {
    const legend = getDashboardSourceHealthLegend({
      total: 14,
      normal: 10,
      warning: 2,
      failed: 1,
      unsynced: 1,
    })

    expect(legend).toEqual([
      expect.objectContaining({ key: 'normal', percent: '71%' }),
      expect.objectContaining({ key: 'warning', percent: '14%' }),
      expect.objectContaining({ key: 'failed', percent: '7%' }),
      expect.objectContaining({ key: 'unsynced', percent: '7%' }),
    ])
  })
})
