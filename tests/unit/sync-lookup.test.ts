import { describe, it, expect } from 'vitest'
import { fuzzyMatch, fuzzyArtist, fuzzyAlbum } from '../../server/lib/sync/lookup'

describe('fuzzyMatch', () => {
  it('returns true for exact match', () => {
    expect(fuzzyMatch('Hello World', 'Hello World')).toBe(true)
  })

  it('returns true for exact match after normalizeTitle', () => {
    // normalizeTitle strips parenthetical and bracketed content
    expect(fuzzyMatch('Song Title (Remastered 2024)', 'Song Title (Deluxe)')).toBe(true)
  })

  it('does not collapse identity-changing bracket variants', () => {
    expect(fuzzyMatch('Track [Live Version]', 'Track [Studio]')).toBe(false)
  })

  it('returns true when punctuation differs', () => {
    // stripPunct removes all punctuation characters
    expect(fuzzyMatch('Dont Stop', "Don't Stop")).toBe(true)
  })

  it('returns false for completely different titles', () => {
    expect(fuzzyMatch('Hello World', 'Goodbye Universe')).toBe(false)
  })

  it('returns false when one string is empty', () => {
    expect(fuzzyMatch('', 'Something')).toBe(false)
    expect(fuzzyMatch('Something', '')).toBe(false)
  })

  it('does not collapse short bracketed variants onto ambiguous base titles', () => {
    expect(fuzzyMatch('III', 'III (Find Yourself)')).toBe(false)
    expect(fuzzyMatch('IV', 'IV [Alt Version]')).toBe(false)
  })

  it('still allows exact short bracketed variant titles', () => {
    expect(fuzzyMatch('III (Find Yourself)', 'III (Find Yourself)')).toBe(true)
  })

  it('still allows non-ambiguous bracketed variants to match their base title', () => {
    expect(fuzzyMatch('Song Title', 'Song Title (Remastered 2024)')).toBe(true)
  })

  it('does not collapse cover titles onto their base song', () => {
    expect(fuzzyMatch('Middle', 'Middle (DJ Snake Cover)')).toBe(false)
    expect(fuzzyMatch('Middle (DJ Snake Cover)', 'Middle')).toBe(false)
  })

  it('handles titles that normalize to empty', () => {
    // normalizeTitle on "(Remix)" produces ""
    expect(fuzzyMatch('(Remix)', '')).toBe(false)
  })
})

describe('fuzzyArtist', () => {
  it('returns true for exact case-insensitive match', () => {
    expect(fuzzyArtist('Taylor Swift', 'taylor swift')).toBe(true)
  })

  it('returns true when Plex artist contains Netease artist', () => {
    expect(fuzzyArtist('Taylor Swift', 'Taylor')).toBe(true)
  })

  it('returns true when Netease artist contains Plex artist', () => {
    expect(fuzzyArtist('Swift', 'Taylor Swift')).toBe(true)
  })

  it('returns true when either artist is empty (lenient)', () => {
    expect(fuzzyArtist('', 'anything')).toBe(true)
    expect(fuzzyArtist('anything', '')).toBe(true)
  })

  it('returns false for completely different artists', () => {
    expect(fuzzyArtist('Adele', 'Taylor Swift')).toBe(false)
  })
})

describe('fuzzyAlbum', () => {
  it('returns true when normalizeTitle strips added detail', () => {
    // normalizeTitle strips parenthetical
    expect(fuzzyAlbum('OK Computer (Remastered)', 'OK Computer')).toBe(true)
  })

  it('returns true after stripPunct normalization', () => {
    expect(fuzzyAlbum('OK Computer', 'OKComputer')).toBe(true)
  })

  it('returns true when Plex album contains Netease stripped title', () => {
    expect(fuzzyAlbum(
      'The Dark Side of the Moon',
      'Dark Side',
    )).toBe(true)
  })

  it('returns true when Netease album contains Plex stripped title', () => {
    expect(fuzzyAlbum(
      'Dark Side',
      'The Dark Side of the Moon',
    )).toBe(true)
  })

  it('returns true when either album is empty (lenient)', () => {
    expect(fuzzyAlbum('', 'anything')).toBe(true)
    expect(fuzzyAlbum('anything', '')).toBe(true)
  })

  it('returns false for completely different albums', () => {
    expect(fuzzyAlbum('Abbey Road', 'Thriller')).toBe(false)
  })
})
