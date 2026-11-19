import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchPlaylistSongs: vi.fn(),
  fetchAlbumSongs: vi.fn(),
  fetchSongDetail: vi.fn(),
}))

vi.mock('~~/server/lib/netease', () => mocks)

function song(id: number, name = `Song ${id}`) {
  return {
    id,
    name,
    no: id,
    dt: 180_000,
    disc: '1',
    artists: [{ name: `Artist ${id}` }],
    album: { id: 10, name: 'Album', picUrl: '', publishTime: 0 },
  }
}

describe('download resource selection', () => {
  beforeEach(() => vi.resetAllMocks())

  it('filters a playlist snapshot in server order for full and partial selection', async () => {
    mocks.fetchPlaylistSongs.mockResolvedValue({
      songs: [song(3), song(1), song(2), song(1)],
      playlistName: 'Ordered list',
    })
    const { selectDownloadResource } = await import('~~/server/lib/download/resource-selection')

    const selected = await selectDownloadResource({
      type: 'playlist',
      resourceId: 99,
      selectedSongIds: [2, 3, 2],
      cookie: 'cookie',
    })

    expect(selected.songs.map(item => item.id)).toEqual([3, 2])
    expect(selected.failures).toEqual([])
    expect(selected.sourceLabel).toBe('Ordered list')
  })

  it('reports selected ids missing from the latest playlist snapshot', async () => {
    mocks.fetchPlaylistSongs.mockResolvedValue({
      songs: [song(1)],
      playlistName: 'Changed list',
    })
    const { selectDownloadResource } = await import('~~/server/lib/download/resource-selection')

    const selected = await selectDownloadResource({
      type: 'playlist',
      resourceId: 99,
      selectedSongIds: [1, 8],
      cookie: 'cookie',
    })

    expect(selected.songs.map(item => item.id)).toEqual([1])
    expect(selected.failures).toEqual([{ songId: 8, reason: '歌曲不在最新资源快照中' }])
  })

  it('preserves requested single-song order, deduplicates ids and exposes fetch failures', async () => {
    mocks.fetchSongDetail.mockImplementation(async (id: number) => {
      if (id === 2) throw new Error('upstream unavailable')
      return song(id)
    })
    const { selectDownloadResource } = await import('~~/server/lib/download/resource-selection')

    const selected = await selectDownloadResource({
      type: 'songs',
      selectedSongIds: [3, 2, 3, 1],
      cookie: 'cookie',
    })

    expect(selected.songs.map(item => item.id)).toEqual([3, 1])
    expect(selected.failures).toEqual([{ songId: 2, reason: 'upstream unavailable' }])
    expect(mocks.fetchSongDetail).toHaveBeenCalledTimes(3)
  })
})
