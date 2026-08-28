import { describe, expect, it } from 'vitest'
import { buildSevenDayDownloadTrend } from './summary'

describe('dashboard download trend', () => {
  it('fills seven local calendar days and ignores invalid or out-of-range timestamps', () => {
    const now = new Date(2026, 7, 27, 20, 0, 0)
    const trend = buildSevenDayDownloadTrend([
      new Date(2026, 7, 21, 8, 0, 0).toISOString(),
      new Date(2026, 7, 26, 8, 0, 0).toISOString(),
      new Date(2026, 7, 26, 9, 0, 0).toISOString(),
      new Date(2026, 7, 20, 8, 0, 0).toISOString(),
      'invalid',
    ], now)

    expect(trend).toHaveLength(7)
    expect(trend.map(point => point.label)).toEqual(['8/21', '8/22', '8/23', '8/24', '8/25', '8/26', '8/27'])
    expect(trend.map(point => point.count)).toEqual([1, 0, 0, 0, 0, 2, 0])
  })
})
