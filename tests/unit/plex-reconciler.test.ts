import { beforeEach, describe, expect, it, vi } from 'vitest'

const searchTrack = vi.fn()
const searchTracksByTitle = vi.fn()
const searchTracksByArtists = vi.fn()
const searchTracksByAlbum = vi.fn()
const getRecentlyAddedTracks = vi.fn()
const findTracksByFilePath = vi.fn()
const resolveSongArtistCandidateNames = vi.fn()
const resolveAccessibleLocalPath = vi.fn()
const normalizeExistingLocalPath = vi.fn()

vi.mock('../../server/lib/plex-client', () => ({
  searchTrack,
  searchTracksByTitle,
  searchTracksByArtists,
  searchTracksByAlbum,
  getRecentlyAddedTracks,
  findTracksByFilePath,
  initPlexClient: vi.fn(),
  findPlaylist: vi.fn(),
  getPlaylistByRatingKey: vi.fn(),
  createPlaylist: vi.fn(),
  refreshLibrary: vi.fn(),
  getSectionKey: vi.fn(),
}))

vi.mock('../../server/lib/sync/reorder', () => ({
  applyFullReorder: vi.fn(),
}))

vi.mock('../../server/lib/sync/lookup', () => ({
  resolveTracks: vi.fn(),
}))

vi.mock('../../server/lib/sync/path-map', () => ({
  mapLocalPathToPlex: vi.fn(() => null),
  resolveAccessibleLocalPath,
  normalizeExistingLocalPath,
}))

vi.mock('../../server/lib/sync/song-artist-candidates', () => ({
  resolveSongArtistCandidateNames,
}))

describe('findTrackWithRetry', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resolveSongArtistCandidateNames.mockResolvedValue(['Streex', 'Marshmello'])
    normalizeExistingLocalPath.mockImplementation((value: string | null | undefined) => value ?? null)
    findTracksByFilePath.mockResolvedValue([])
    searchTracksByTitle.mockResolvedValue([])
    searchTracksByArtists.mockResolvedValue([])
    searchTracksByAlbum.mockResolvedValue([])
    getRecentlyAddedTracks.mockResolvedValue([])
  })

  it('uses all song artists during direct Plex search', async () => {
    searchTrack.mockResolvedValue({ ratingKey: 'rk-direct' })

    const { findTrackWithRetry } = await import('../../server/lib/sync/plex-reconciler')
    const result = await findTrackWithRetry(
      '12',
      {
        id: 1,
        name: 'Alone (Streex Remake)',
        no: 1,
        dt: 1,
        disc: '1',
        artists: [{ name: 'Streex' }, { name: 'Marshmello' }],
        album: { id: 1, name: 'Alone (Streex Remake)', picUrl: '', publishTime: 0 },
      },
      {} as any,
      null,
      0,
      0,
    )

    expect(result).toBe('rk-direct')
    expect(searchTrack).toHaveBeenCalledWith('12', 'Alone (Streex Remake)', ['Streex', 'Marshmello'], 'Alone (Streex Remake)')
  })

  it('falls back to path matching across title and artist candidates', async () => {
    searchTrack.mockResolvedValue(null)
    searchTracksByAlbum.mockResolvedValue([])
    searchTracksByTitle.mockResolvedValue([
      {
        ratingKey: 'rk-title',
        Media: [{ Part: [{ file: '/volume1/06_Music/Marshmello/Wrong.flac' }] }],
      },
    ])
    searchTracksByArtists.mockResolvedValue([
      {
        ratingKey: 'rk-artist',
        Media: [{ Part: [{ file: '/volume1/06_Music/Streex/Alone.flac' }] }],
      },
    ])
    resolveAccessibleLocalPath
      .mockReturnValueOnce('/downloads/Marshmello/Wrong.flac')
      .mockReturnValueOnce('/downloads/Streex/Alone.flac')

    const { findTrackWithRetry } = await import('../../server/lib/sync/plex-reconciler')
    const result = await findTrackWithRetry(
      '12',
      {
        id: 1,
        name: 'Alone (Streex Remake)',
        no: 1,
        dt: 1,
        disc: '1',
        artists: [{ name: 'Streex' }, { name: 'Marshmello' }],
        album: { id: 1, name: 'Alone (Streex Remake)', picUrl: '', publishTime: 0 },
      },
      {} as any,
      '/downloads/Streex/Alone.flac',
      0,
      0,
    )

    expect(result).toBe('rk-artist')
    expect(searchTracksByTitle).toHaveBeenCalledWith('12', 'Alone (Streex Remake)')
    expect(searchTracksByArtists).toHaveBeenCalledWith('12', ['Streex', 'Marshmello'])
    expect(searchTracksByAlbum).toHaveBeenCalledWith('12', 'Alone (Streex Remake)')
  })

  it('falls back to album path matching when title and artist candidates miss', async () => {
    searchTrack.mockResolvedValue(null)
    searchTracksByTitle.mockResolvedValue([])
    searchTracksByArtists.mockResolvedValue([])
    getRecentlyAddedTracks.mockResolvedValue([])
    searchTracksByAlbum.mockResolvedValue([
      {
        ratingKey: 'rk-album',
        Media: [{ Part: [{ file: '/volume1/06_Music/Streex/Album/Alone.flac' }] }],
      },
    ])
    normalizeExistingLocalPath.mockReturnValue('/downloads/Streex/Album/Alone.flac')
    resolveAccessibleLocalPath.mockReturnValue('/downloads/Streex/Album/Alone.flac')

    const { findTrackWithRetryDetailed } = await import('../../server/lib/sync/plex-reconciler')
    const result = await findTrackWithRetryDetailed(
      '12',
      {
        id: 1,
        name: 'Alone',
        no: 1,
        dt: 1,
        disc: '1',
        artists: [{ name: 'Streex' }],
        album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 },
      },
      {} as any,
      '/downloads/Streex/Album/Alone.flac',
      0,
      0,
    )

    expect(result.ratingKey).toBe('rk-album')
    expect(result.matchedBy).toBe('album_path_lookup')
  })
})
