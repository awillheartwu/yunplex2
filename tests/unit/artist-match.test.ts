import { describe, it, expect } from 'vitest'
import { isArtistNameMatch, normalizeArtistName } from '../../server/lib/sync/artist-match'

describe('normalizeArtistName', () => {
  it('lowercases and trims', () => {
    expect(normalizeArtistName('  Keiichiro Shibuya  ')).toBe('keiichiro shibuya')
  })

  it('collapses whitespace', () => {
    expect(normalizeArtistName('Keiichiro   Shibuya')).toBe('keiichiro shibuya')
  })

  it('normalizes unicode (NFC)', () => {
    // é as combined vs precomposed
    const composed = 'Beyoncé'
    const precomposed = 'Beyoncé'
    expect(normalizeArtistName(composed)).toBe(normalizeArtistName(precomposed))
  })
})

describe('isArtistNameMatch', () => {
  it('returns true for exact match', () => {
    expect(isArtistNameMatch('Keiichiro Shibuya', 'Keiichiro Shibuya')).toBe(true)
  })

  it('returns true case-insensitive', () => {
    expect(isArtistNameMatch('KEIICHIRO SHIBUYA', 'keiichiro shibuya')).toBe(true)
  })

  it('returns true when either string is empty (lenient)', () => {
    expect(isArtistNameMatch('', 'anything')).toBe(true)
    expect(isArtistNameMatch('anything', '')).toBe(true)
  })

  it('returns true after punctuation strip', () => {
    expect(isArtistNameMatch('AC/DC', 'ACDC')).toBe(true)
  })

  it('returns true for simplified ↔ traditional Chinese', () => {
    expect(isArtistNameMatch('周杰伦', '周杰倫')).toBe(true)
    expect(isArtistNameMatch('草东没有派对', '草東沒有派對')).toBe(true)
  })

  it('returns true for substring containment (Plex full name contains candidate)', () => {
    // "Keiichiro" is contained in "Keiichiro Shibuya"
    expect(isArtistNameMatch('Keiichiro Shibuya', 'Keiichiro')).toBe(true)
  })

  it('returns true when Plex name contains candidate (substring)', () => {
    expect(isArtistNameMatch('Keiichiro Shibuya', 'Keiichiro Shibuya')).toBe(true)
  })

  it('returns false for completely different names', () => {
    expect(isArtistNameMatch('Taylor Swift', 'Kanye West')).toBe(false)
  })

  it('returns false for short name substring collision', () => {
    // "Li" is 2 chars — should not match "Liam" via substring
    expect(isArtistNameMatch('Li', 'Liam')).toBe(false)
  })

  it('returns true for feat/ft variants via punctuation strip', () => {
    // Period is stripped, "feat" stays "feat" and "ft" stays "ft"
    // They are both contained in "Drake" + stripped remainder
    // Actually "drake feat rihanna" contains "drake" and vice versa via substring
    expect(isArtistNameMatch('Drake feat. Rihanna', 'Drake feat Rihanna')).toBe(true)
  })

  it('returns true for s2t round trip', () => {
    expect(isArtistNameMatch('苦难精算师', '苦難精算師')).toBe(true)
  })
})
