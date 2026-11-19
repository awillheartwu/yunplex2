import { describe, expect, it } from 'vitest'
import {
  formatDateFilterLabel,
  parseAllowedQueryValue,
  parseDateQueryValue,
} from '../../composables/useFilterQuery'

describe('filter query validation', () => {
  it('only restores values represented by the current filter controls', () => {
    expect(parseAllowedQueryValue('cancelled', ['running', 'cancelled'] as const)).toBe('cancelled')
    expect(parseAllowedQueryValue('done', ['running', 'cancelled'] as const)).toBeUndefined()
    expect(parseAllowedQueryValue(['repair', 'sync'], ['sync', 'repair'] as const)).toBe('repair')
  })

  it('rejects malformed and impossible calendar dates', () => {
    expect(parseDateQueryValue('2026-06-22')).toBe('2026-06-22')
    expect(parseDateQueryValue('2026-02-31')).toBeUndefined()
    expect(parseDateQueryValue('June 22')).toBeUndefined()
  })

  it('formats shared date range chip labels', () => {
    expect(formatDateFilterLabel('2026-06-01', '2026-06-30')).toBe('日期：2026-06-01 至 2026-06-30')
    expect(formatDateFilterLabel('2026-06-01', null)).toBe('日期：2026-06-01 起')
    expect(formatDateFilterLabel(null, '2026-06-30')).toBe('日期：截至 2026-06-30')
  })
})
