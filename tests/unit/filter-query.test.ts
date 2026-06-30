import { describe, expect, it } from 'vitest'
import {
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
})
