import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRecentlyAddedTracks = vi.fn()
const searchTrack = vi.fn()
const searchTracksByArtists = vi.fn()
const searchTracksByAlbum = vi.fn()
const searchTracksByTitle = vi.fn()
const findTracksByFilePath = vi.fn()
const resolveSongArtistCandidateNames = vi.fn()

vi.mock('~~/server/lib/plex-client', () => ({
  getRecentlyAddedTracks,
  searchTrack,
  searchTracksByArtists,
  searchTracksByAlbum,
  searchTracksByTitle,
  findTracksByFilePath,
}))

vi.mock('~~/server/lib/sync/path-map', () => ({
  mapLocalPathToPlex: (value: string | null | undefined) => value ?? null,
  normalizeExistingLocalPath: (value: string | null | undefined) => value ?? null,
  resolveAccessibleLocalPath: (value: string | null | undefined) => value ?? null,
}))

vi.mock('~~/server/lib/sync/song-artist-candidates', () => ({
  resolveSongArtistCandidateNames,
}))

describe('plex retry matcher', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    findTracksByFilePath.mockResolvedValue([])
  })

  it('uses the paginated Plex path index before metadata searches', async () => {
    findTracksByFilePath.mockResolvedValue([{
      ratingKey: 'rk-indexed',
      Media: [{ Part: [{ file: '/downloads/Artist/Album/song.flac' }] }],
    }])
    resolveSongArtistCandidateNames.mockResolvedValue(['Artist'])

    const { matchTrackInPlexWithRetry } = await import('~~/server/lib/sync/plex-match')
    const result = await matchTrackInPlexWithRetry(
      '12',
      {
        id: 1,
        name: 'song',
        artists: [{ name: 'Artist' }],
        album: { id: 1, name: 'Album' },
      } as any,
      {} as any,
      '/downloads/Artist/Album/song.flac',
      0,
      0,
    )

    expect(result).toMatchObject({ ratingKey: 'rk-indexed', matchedBy: 'path_lookup', attempts: 1 })
    expect(searchTrack).not.toHaveBeenCalled()
  })

  it('uses only exact paths in missing-media mode', async () => {
    findTracksByFilePath.mockResolvedValue([])
    getRecentlyAddedTracks.mockResolvedValue([])

    const { matchTrackInPlexWithRetry } = await import('~~/server/lib/sync/plex-match')
    const result = await matchTrackInPlexWithRetry(
      '12',
      {
        id: 1,
        name: 'song',
        artists: [{ name: 'Artist' }],
        album: { id: 1, name: 'Album' },
      } as any,
      {} as any,
      '/downloads/Artist/Album/song.flac',
      0,
      0,
      { pathOnly: true },
    )

    expect(result.ratingKey).toBeNull()
    expect(resolveSongArtistCandidateNames).not.toHaveBeenCalled()
    expect(searchTrack).not.toHaveBeenCalled()
    expect(searchTracksByTitle).not.toHaveBeenCalled()
    expect(searchTracksByArtists).not.toHaveBeenCalled()
    expect(searchTracksByAlbum).not.toHaveBeenCalled()
  })

  it('does not bind when multiple rating keys point to the same exact path', async () => {
    findTracksByFilePath.mockResolvedValue([
      {
        ratingKey: 'duplicate-a',
        Media: [{ Part: [{ file: '/downloads/Artist/Album/song.flac' }] }],
      },
      {
        ratingKey: 'duplicate-b',
        Media: [{ Part: [{ file: '/downloads/Artist/Album/song.flac' }] }],
      },
    ])
    getRecentlyAddedTracks.mockResolvedValue([])

    const { matchTrackInPlexWithRetry } = await import('~~/server/lib/sync/plex-match')
    const result = await matchTrackInPlexWithRetry(
      '12',
      {
        id: 1,
        name: 'song',
        artists: [{ name: 'Artist' }],
        album: { id: 1, name: 'Album' },
      } as any,
      {} as any,
      '/downloads/Artist/Album/song.flac',
      0,
      0,
      { pathOnly: true },
    )

    expect(result.ratingKey).toBeNull()
    expect(result.traces[0]?.pathCandidates).toBe(2)
  })

  it('falls back to recently added path lookup when metadata search misses', async () => {
    searchTrack.mockResolvedValue(null)
    searchTracksByTitle.mockResolvedValue([])
    searchTracksByArtists.mockResolvedValue([])
    searchTracksByAlbum.mockResolvedValue([])
    getRecentlyAddedTracks.mockResolvedValue([
      {
        ratingKey: 'rk-42',
        Media: [{ Part: [{ file: '/downloads/觀觀Guanguan/槟榔观音/05 - 歌颂我.flac' }] }],
      },
    ])
    resolveSongArtistCandidateNames.mockResolvedValue(['觀觀Guanguan'])

    const { matchTrackInPlexWithRetry } = await import('~~/server/lib/sync/plex-match')
    const result = await matchTrackInPlexWithRetry(
      '12',
      {
        id: 2032183122,
        name: '歌颂我',
        no: 5,
        dt: 123000,
        artists: [{ name: '觀觀Guanguan' }],
        album: { id: 1, name: '槟榔观音' },
      } as any,
      {} as any,
      '/downloads/觀觀Guanguan/槟榔观音/05 - 歌颂我.flac',
      0,
      0,
    )

    expect(result.ratingKey).toBe('rk-42')
    expect(result.matchedBy).toBe('recent_path_lookup')
    expect(getRecentlyAddedTracks).toHaveBeenCalledWith('12', 100)
  })

  it('prefers an exact file path over an older metadata-only match', async () => {
    findTracksByFilePath.mockResolvedValue([{
      ratingKey: 'rk-exact',
      Media: [{ Part: [{ file: '/downloads/夏日入侵企画/砳 (2017)/01 - 人生浪费指南.flac' }] }],
    }])
    searchTrack.mockResolvedValue({
      ratingKey: 'rk-old',
      title: '人生浪费指南',
      grandparentTitle: 'Summer Warz',
      parentTitle: '人生浪费指南',
      Media: [{ Part: [{ file: '/downloads/夏日入侵企画/人生浪费指南/01. 人生浪费指南.flac' }] }],
    })
    searchTracksByTitle.mockResolvedValue([
      {
        ratingKey: 'rk-old',
        Media: [{ Part: [{ file: '/downloads/夏日入侵企画/人生浪费指南/01. 人生浪费指南.flac' }] }],
      },
      {
        ratingKey: 'rk-exact',
        Media: [{ Part: [{ file: '/downloads/夏日入侵企画/砳 (2017)/01 - 人生浪费指南.flac' }] }],
      },
    ])
    searchTracksByArtists.mockResolvedValue([])
    searchTracksByAlbum.mockResolvedValue([])
    getRecentlyAddedTracks.mockResolvedValue([])
    resolveSongArtistCandidateNames.mockResolvedValue(['夏日入侵企画', 'Summer Warz'])

    const { matchTrackInPlexWithRetry } = await import('~~/server/lib/sync/plex-match')
    const result = await matchTrackInPlexWithRetry(
      '12',
      {
        id: 497572729,
        name: '人生浪费指南',
        no: 1,
        dt: 353676,
        disc: '1',
        artists: [{ name: '夏日入侵企画' }],
        album: { id: 84153693, name: '砳', picUrl: '', publishTime: 1502452431422 },
      },
      {} as any,
      '/downloads/夏日入侵企画/砳 (2017)/01 - 人生浪费指南.flac',
      0,
      0,
    )

    expect(result).toMatchObject({ ratingKey: 'rk-exact', matchedBy: 'path_lookup' })
  })

  it('does not accept a metadata-only candidate when a concrete local file must be indexed', async () => {
    searchTrack.mockResolvedValue({
      ratingKey: 'rk-unrelated-copy',
      Media: [{ Part: [{ file: '/downloads/旧目录/同名歌曲.flac' }] }],
    })
    searchTracksByTitle.mockResolvedValue([])
    searchTracksByArtists.mockResolvedValue([])
    searchTracksByAlbum.mockResolvedValue([])
    getRecentlyAddedTracks.mockResolvedValue([])
    resolveSongArtistCandidateNames.mockResolvedValue(['Artist'])

    const { matchTrackInPlexWithRetry } = await import('~~/server/lib/sync/plex-match')
    const result = await matchTrackInPlexWithRetry(
      '12',
      {
        id: 1,
        name: '同名歌曲',
        no: 1,
        dt: 1000,
        disc: '1',
        artists: [{ name: 'Artist' }],
        album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 },
      },
      {} as any,
      '/downloads/新目录/同名歌曲.flac',
      0,
      0,
    )

    expect(result.ratingKey).toBeNull()
    expect(result.matchedBy).toBeNull()
  })
})
