import { describe, it, expect } from 'vitest'
import { normalizeForSearch, titleIdentityDescriptorsCompatible, extractTitleIdentityDescriptors } from '../../server/lib/sync/matchers'

describe('normalizeForSearch', () => {
  it('strips Western parenthetical content', () => {
    expect(normalizeForSearch('Song Title (feat. Someone)')).toBe('Song Title')
  })

  it('strips Chinese parenthetical content', () => {
    expect(normalizeForSearch('歌名（feat. 某人）')).toBe('歌名')
  })

  it('strips Chinese square bracket content', () => {
    expect(normalizeForSearch('标题【备注】')).toBe('标题')
  })

  it('strips Chinese book-title brackets', () => {
    expect(normalizeForSearch('歌曲《版本》')).toBe('歌曲')
  })

  it('strips punctuation and special characters', () => {
    expect(normalizeForSearch('Hello, World!')).toBe('Hello World')
  })

  it('strips smart quotes', () => {
    expect(normalizeForSearch('What’s “Up”')).toBe('What s Up')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeForSearch('  Multiple   Spaces  ')).toBe('Multiple Spaces')
  })

  it('handles mixed Chinese brackets and Western parentheses', () => {
    // normalizeForSearch strips Chinese/Western parentheses and all Chinese bracket
    // variants, but intentionally preserves Western square brackets []
    const result = normalizeForSearch('A（B）(C)《D》')
    expect(result).toBe('A')
  })

  it('does not modify plain text', () => {
    expect(normalizeForSearch('Plain Text 123')).toBe('Plain Text 123')
  })
})

describe('title identity descriptors', () => {
  it('extracts meaningful identity descriptors from bracket text', () => {
    expect(extractTitleIdentityDescriptors('Middle (DJ Snake Cover)')).toEqual(['cover'])
    expect(extractTitleIdentityDescriptors('歌曲（现场版）')).toEqual(['live'])
  })

  it('treats same semantic variant as compatible', () => {
    expect(titleIdentityDescriptorsCompatible('I See Fire (Kygo Remix)', 'I See Fire (Kygo remix)')).toBe(true)
  })

  it('blocks cover vs base-title collapse', () => {
    expect(titleIdentityDescriptorsCompatible('Middle (DJ Snake Cover)', 'Middle')).toBe(false)
  })
})
