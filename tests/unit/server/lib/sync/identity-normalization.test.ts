import { describe, expect, it } from 'vitest'
import {
  foldPlexPath,
  normalizePlexPath,
  plexPathsExactlyEqual,
  resolvePlexIdentityPath,
} from '~~/server/lib/sync/identity-normalization'

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

  it('repairs a stored relative path that accidentally includes the section root', () => {
    expect(resolvePlexIdentityPath({
      relativePath: 'volume1/music/Artist/Album/Song.flac',
      currentSectionRoot: '/volume1/music',
      lastObservedPath: '/volume1/music/Artist/Album/Song.flac',
    })).toBe('/volume1/music/Artist/Album/Song.flac')
  })
})
