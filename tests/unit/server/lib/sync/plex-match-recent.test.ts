import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRecentlyAddedTracks = vi.fn()
const findTracksByFilePath = vi.fn()

vi.mock('~~/server/lib/plex-client', () => ({
  getRecentlyAddedTracks,
  findTracksByFilePath,
}))

vi.mock('~~/server/lib/sync/path-map', () => ({
  mapLocalPathToPlex: (value: string | null | undefined) => value ?? null,
  normalizeExistingLocalPath: (value: string | null | undefined) => value ?? null,
  resolveAccessibleLocalPath: (value: string | null | undefined) => value ?? null,
}))

describe('plex retry matcher', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    findTracksByFilePath.mockResolvedValue([])
  })

  it('uses the paginated Plex path index', async () => {
    findTracksByFilePath.mockResolvedValue([{
      ratingKey: 'rk-indexed',
      Media: [{ Part: [{ file: '/downloads/Artist/Album/song.flac' }] }],
    }])

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
  })

  it('returns no match when neither path lookup finds the file', async () => {
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
    )

    expect(result.ratingKey).toBeNull()
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
    )

    expect(result.ratingKey).toBeNull()
    expect(result.traces[0]?.pathCandidates).toBe(2)
  })

  it('falls back to recently added path lookup when the path index misses', async () => {
    getRecentlyAddedTracks.mockResolvedValue([
      {
        ratingKey: 'rk-42',
        Media: [{ Part: [{ file: '/downloads/觀觀Guanguan/槟榔观音/05 - 歌颂我.flac' }] }],
      },
    ])

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
})
