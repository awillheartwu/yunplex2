import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDashboardLastSyncLabel, formatDashboardRelativeTime } from './useDashboardFormat'

describe('dashboard time formatting', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats recent times relative to now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'))

    expect(formatDashboardRelativeTime('2026-06-11T11:59:20.000Z')).toBe('刚刚')
    expect(formatDashboardRelativeTime('2026-06-11T11:20:00.000Z')).toBe('40 分钟前')
    expect(formatDashboardRelativeTime('2026-06-11T09:00:00.000Z')).toBe('3 小时前')
    expect(formatDashboardRelativeTime('2026-06-08T12:00:00.000Z')).toBe('3 天前')
  })

  it('builds the toolbar sync label', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'))

    expect(formatDashboardLastSyncLabel('2026-06-11T11:57:00.000Z')).toBe('上次同步 3 分钟前')
    expect(formatDashboardLastSyncLabel(null)).toBe('暂未同步')
  })
})
