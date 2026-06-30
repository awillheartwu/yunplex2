import { beforeEach, describe, expect, it, vi } from 'vitest'

const searchTrack = vi.fn()
const searchTracksByTitle = vi.fn()
const searchTracksByArtists = vi.fn()
const resolveSongArtistCandidateNames = vi.fn()
const resolveAccessibleLocalPath = vi.fn()
const normalizeExistingLocalPath = vi.fn()

vi.mock('../../server/lib/plex-client', () => ({
  searchTrack,
  searchTracksByTitle,
  searchTracksByArtists,
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
    normalizeExistingLocalPath.mockReturnValue('/downloads/Streex/Alone.flac')
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
      '/downloads/Streex/Alone.flac',
      0,
      0,
    )

    expect(result).toBe('rk-direct')
    expect(searchTrack).toHaveBeenCalledWith('12', 'Alone (Streex Remake)', ['Streex', 'Marshmello'], 'Alone (Streex Remake)')
  })

  it('falls back to path matching across title and artist candidates', async () => {
    searchTrack.mockResolvedValue(null)
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
  })
})
