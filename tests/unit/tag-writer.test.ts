import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildFlacTagMap, checkAncillaryFiles } from '../../server/lib/tag-writer'
import { existsSync } from 'node:fs'

// Mock fs
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => false) }))
import type { SongMeta } from '../../server/lib/tag-writer'

function makeMeta(overrides: Partial<SongMeta> = {}): SongMeta {
  return {
    title: 'Test Song',
    albumArtist: 'Test Artist',
    trackArtist: '',
    album: 'Test Album',
    trackNumber: 1,
    publishTime: 0,
    picUrl: '',
    duration: 0,
    discNumber: '1',
    totalDiscs: 1,
    totalTracks: 0,
    genre: '',
    releaseDate: '',
    albumDescription: '',
    recordLabel: '',
    releaseType: '',
    artistImgUrl: '',
    ...overrides,
  }
}

describe('buildFlacTagMap', () => {
  it('always includes required fields', () => {
    const tags = buildFlacTagMap(makeMeta())
    expect(tags.TITLE).toBe('Test Song')
    expect(tags.ALBUMARTIST).toBe('Test Artist')
    expect(tags.ALBUM).toBe('Test Album')
    expect(tags.TRACKNUMBER).toBe('1')
  })

  it('includes YEAR and DATE when publishTime > 0', () => {
    // Use a known timestamp: 2023-11-15
    const ts = new Date('2023-11-15').getTime()
    const tags = buildFlacTagMap(makeMeta({ publishTime: ts }))
    expect(tags.YEAR).toBe('2023')
    expect(tags.DATE).toBe('2023-11-15')
  })

  it('omits YEAR and DATE when publishTime is 0', () => {
    const tags = buildFlacTagMap(makeMeta({ publishTime: 0 }))
    expect(tags.YEAR).toBeUndefined()
    expect(tags.DATE).toBeUndefined()
  })

  it('uses releaseDate over computed DATE when set', () => {
    const ts = new Date('2023-11-15').getTime()
    const tags = buildFlacTagMap(makeMeta({ publishTime: ts, releaseDate: '2024-01-01' }))
    expect(tags.DATE).toBe('2024-01-01')
  })

  it('prefers trackArtist over albumArtist for ARTIST', () => {
    const tags = buildFlacTagMap(makeMeta({ trackArtist: 'A & B', albumArtist: 'A' }))
    expect(tags.ARTIST).toBe('A & B')
  })

  it('falls back to albumArtist when trackArtist is empty', () => {
    const tags = buildFlacTagMap(makeMeta({ trackArtist: '', albumArtist: 'A' }))
    expect(tags.ARTIST).toBe('A')
  })

  it('converts duration in ms to LENGTH (M:SS)', () => {
    const tags = buildFlacTagMap(makeMeta({ duration: 245000 }))
    expect(tags.LENGTH).toBe('4:05')
  })

  it('handles single-digit seconds in LENGTH', () => {
    const tags = buildFlacTagMap(makeMeta({ duration: 183000 }))
    expect(tags.LENGTH).toBe('3:03')
  })

  it('omits LENGTH when duration is 0', () => {
    const tags = buildFlacTagMap(makeMeta({ duration: 0 }))
    expect(tags.LENGTH).toBeUndefined()
  })

  it('includes disc info: single disc (no DISCTOTAL)', () => {
    const tags = buildFlacTagMap(makeMeta({ discNumber: '1', totalDiscs: 1 }))
    expect(tags.DISCNUMBER).toBe('1')
    expect(tags.DISCTOTAL).toBeUndefined()
  })

  it('includes disc info: multi-disc with DISCTOTAL', () => {
    const tags = buildFlacTagMap(makeMeta({ discNumber: '2', totalDiscs: 3 }))
    expect(tags.DISCNUMBER).toBe('2/3')
    expect(tags.DISCTOTAL).toBe('3')
  })

  it('includes TOTALTRACKS only when > 0', () => {
    const withTotal = buildFlacTagMap(makeMeta({ totalTracks: 12 }))
    expect(withTotal.TOTALTRACKS).toBe('12')

    const without = buildFlacTagMap(makeMeta({ totalTracks: 0 }))
    expect(without.TOTALTRACKS).toBeUndefined()
  })

  it('includes optional fields only when truthy', () => {
    const tags = buildFlacTagMap(makeMeta({
      genre: 'Rock',
      albumDescription: 'Great album',
      recordLabel: 'Sony',
      releaseType: 'Album',
      trackArtist: 'Solo',
    }))
    // Let's just check they're all present
    expect(tags.GENRE).toBe('Rock')
    expect(tags.DESCRIPTION).toBe('Great album')
    expect(tags.PUBLISHER).toBe('Sony')
    expect(tags.RELEASETYPE).toBe('Album')
  })

  it('omits optional fields when empty/falsy', () => {
    const tags = buildFlacTagMap(makeMeta({
      genre: '',
      albumDescription: '',
      recordLabel: '',
      releaseType: '',
    }))
    expect(tags.GENRE).toBeUndefined()
    expect(tags.DESCRIPTION).toBeUndefined()
    expect(tags.PUBLISHER).toBeUndefined()
    expect(tags.RELEASETYPE).toBeUndefined()
  })
})

// ── checkAncillaryFiles ──
describe('checkAncillaryFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const testPath = '/music/Artist/Album/song.mp3'
  const baseOpts = {
    writeLyrics: true,
    saveAlbumCover: false,
    saveArtistImage: false,
  }

  it('romajiLyricExists is true when hasRomajiLyric is false (nothing to write)', () => {
    const result = checkAncillaryFiles(testPath, {
      ...baseOpts,
      writeLyrics: true,
      hasRomajiLyric: false,
    })
    expect(result.romajiLyricExists).toBe(true)
  })

  it('romajiLyricExists checks disk when hasRomajiLyric is true', () => {
    vi.mocked(existsSync).mockReturnValue(false)

    const result = checkAncillaryFiles(testPath, {
      ...baseOpts,
      writeLyrics: true,
      hasRomajiLyric: true,
    })
    expect(result.romajiLyricExists).toBe(false)
    expect(existsSync).toHaveBeenCalledWith('/music/Artist/Album/song (romaji).lrc')
  })

  it('translatedLyricExists mirrors lyricExists in non-separate merged mode', () => {
    vi.mocked(existsSync).mockReturnValue(true)

    const result = checkAncillaryFiles(testPath, {
      ...baseOpts,
      writeLyrics: true,
      hasTranslatedLyric: true,
      separateLyricFiles: false,
    })
    expect(result.translatedLyricExists).toBe(true) // mirrors lyricExists
  })

  it('translatedLyricExists is true when hasTranslatedLyric is false', () => {
    const result = checkAncillaryFiles(testPath, {
      ...baseOpts,
      writeLyrics: true,
      hasTranslatedLyric: false,
    })
    expect(result.translatedLyricExists).toBe(true)
  })

  it('separate mode checks individual orgi and trans files', () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false)

    const result = checkAncillaryFiles(testPath, {
      ...baseOpts,
      writeLyrics: true,
      hasTranslatedLyric: true,
      separateLyricFiles: true,
    })
    expect(result.lyricExists).toBe(true)
    expect(result.translatedLyricExists).toBe(false)
    expect(existsSync).toHaveBeenCalledWith('/music/Artist/Album/song (orgi).lrc')
    expect(existsSync).toHaveBeenCalledWith('/music/Artist/Album/song (trans).lrc')
  })

  it('all fields false when writeLyrics is disabled', () => {
    const result = checkAncillaryFiles(testPath, {
      ...baseOpts,
      writeLyrics: false,
    })
    expect(result.lyricExists).toBe(false)
    expect(result.translatedLyricExists).toBe(false)
    expect(result.romajiLyricExists).toBe(false)
  })
})
