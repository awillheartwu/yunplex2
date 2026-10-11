import { describe, expect, it } from 'vitest'
import { parseJsonObject, parseJsonOr } from '~~/server/lib/json'

describe('persisted JSON parsing', () => {
  it('returns parsed JSON and falls back for missing or malformed values', () => {
    expect(parseJsonOr<string[]>('["one"]', [])).toEqual(['one'])
    expect(parseJsonOr(null, ['fallback'])).toEqual(['fallback'])
    expect(parseJsonOr('{', { fallback: true })).toEqual({ fallback: true })
  })

  it('accepts plain objects but rejects arrays, primitives, and null', () => {
    expect(parseJsonObject('{"source":"path"}')).toEqual({ source: 'path' })
    expect(parseJsonObject('["path"]')).toEqual({})
    expect(parseJsonObject('1')).toEqual({})
    expect(parseJsonObject('null')).toEqual({})
  })

})
