import { describe, expect, it } from 'vitest'
import {
  foldPlexPath,
  normalizePlexPath,
  plexPathsExactlyEqual,
} from './identity-normalization'

describe('Plex identity path normalization', () => {
  it('canonicalizes separators, dot segments, whitespace, and Unicode', () => {
    expect(normalizePlexPath(' /music//Artist/./Album/../Song/Cafe\u0301.flac/ '))
      .toBe('/music/Artist/Song/Café.flac')
  })

  it('keeps exact identity case-sensitive', () => {
    expect(plexPathsExactlyEqual('/music/Song.flac', '/music/song.flac')).toBe(false)
  })

  it('uses folding only as a recovery lookup key', () => {
    expect(foldPlexPath('/music/Song.flac')).toBe(foldPlexPath('\\music\\song.flac'))
  })
})
