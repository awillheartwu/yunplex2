import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRecentlyAddedTracks = vi.fn()
const searchTrack = vi.fn()
const searchTracksByArtists = vi.fn()
const searchTracksByTitle = vi.fn()
const resolveSongArtistCandidateNames = vi.fn()

vi.mock('../plex-client', () => ({
  getRecentlyAddedTracks,
  searchTrack,
  searchTracksByArtists,
  searchTracksByTitle,
}))

vi.mock('./path-map', () => ({
  normalizeExistingLocalPath: (value: string | null | undefined) => value ?? null,
  resolveAccessibleLocalPath: (value: string | null | undefined) => value ?? null,
}))

vi.mock('./song-artist-candidates', () => ({
  resolveSongArtistCandidateNames,
}))

describe('plex retry matcher', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('falls back to recently added path lookup when metadata search misses', async () => {
    searchTrack.mockResolvedValue(null)
    searchTracksByTitle.mockResolvedValue([])
    searchTracksByArtists.mockResolvedValue([])
    getRecentlyAddedTracks.mockResolvedValue([
      {
        ratingKey: 'rk-42',
        Media: [{ Part: [{ file: '/downloads/觀觀Guanguan/槟榔观音/05 - 歌颂我.flac' }] }],
      },
    ])
    resolveSongArtistCandidateNames.mockResolvedValue(['觀觀Guanguan'])

    const { matchTrackInPlexWithRetry } = await import('./plex-match')
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
})
