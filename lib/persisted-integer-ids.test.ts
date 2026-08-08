import { describe, expect, it } from 'vitest'
import { parsePersistedIntegerIds, serializePersistedIntegerIds } from './persisted-integer-ids'

describe('persisted integer ids', () => {
  it('normalizes values without allowing corrupt entries through', () => {
    expect(parsePersistedIntegerIds('[12,"34",12,0,-1,1.5,"nope",null]')).toEqual({
      ids: [12, 34],
      issues: ['non_canonical_entry', 'duplicate_entry', 'invalid_entry'],
    })
  })

  it('reports malformed and incorrectly shaped values', () => {
    expect(parsePersistedIntegerIds('{')).toEqual({ ids: [], issues: ['invalid_json'] })
    expect(parsePersistedIntegerIds('{"12":true}')).toEqual({ ids: [], issues: ['not_array'] })
  })

  it('treats missing and whitespace-only values as an empty valid collection', () => {
    expect(parsePersistedIntegerIds(null)).toEqual({ ids: [], issues: [] })
    expect(parsePersistedIntegerIds('')).toEqual({ ids: [], issues: [] })
    expect(parsePersistedIntegerIds('  ')).toEqual({ ids: [], issues: [] })
  })

  it('serializes canonical values and stores an empty collection as null', () => {
    expect(serializePersistedIntegerIds([12, 34])).toBe('[12,34]')
    expect(serializePersistedIntegerIds([])).toBeNull()
  })
})
