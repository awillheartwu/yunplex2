import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const songDetail = vi.hoisted(() => vi.fn())
const playlistDetail = vi.hoisted(() => vi.fn())

vi.mock('NeteaseCloudMusicApi', () => ({
  default: {
    login_status: vi.fn(),
    song_url_v1: vi.fn(),
    lyric_new: vi.fn(),
    song_detail: songDetail,
    album: vi.fn(),
    user_playlist: vi.fn(),
    album_sublist: vi.fn(),
    playlist_detail: playlistDetail,
  },
}))

function rawSong(id: number, name: string) {
  return {
    id,
    name,
    no: 1,
    dt: 1000,
    cd: '1',
    ar: [{ id: 2116, name: 'Artist' }],
    al: { id, name: 'Album', picUrl: '', publishTime: 0, artist: { id: 2116, name: 'Artist' } },
  }
}

describe('fetchPlaylistSongs safety', () => {
  beforeEach(() => {
    vi.resetModules()
    songDetail.mockReset()
    playlistDetail.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reconstructs authoritative order, preserves duplicates, and exposes missing detail IDs', async () => {
    playlistDetail.mockResolvedValue({
      status: 200,
      body: {
        code: 200,
        playlist: {
          name: 'Test',
          trackIds: [{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }],
          trackUpdateTime: 123,
        },
      },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    songDetail.mockResolvedValue({ body: { songs: [rawSong(3, 'Three'), rawSong(1, 'One')] } })

    const { fetchPlaylistSongs } = await import('./netease')
    const result = await fetchPlaylistSongs(100, undefined, 'cookie')

    expect(result.trackIds.map(track => track.id)).toEqual([1, 2, 1, 3])
    expect(result.songs.map(song => song.id)).toEqual([1, 1, 3])
    expect(result.songs[0]?.artists[0]?.id).toBe(2116)
    expect(result.songs[0]?.album.artist?.id).toBe(2116)
    expect(playlistDetail).toHaveBeenCalledWith({ id: 100, cookie: 'cookie' })
  })

  it('rejects an HTTP failure instead of presenting an empty destructive target', async () => {
    playlistDetail.mockResolvedValue({ status: 503, body: { code: 503 } })
    const { fetchPlaylistSongs } = await import('./netease')

    await expect(fetchPlaylistSongs(100, undefined, 'cookie')).rejects.toThrow('HTTP 503')
    expect(songDetail).not.toHaveBeenCalled()
  })

  it('rejects a successful-looking response without playlist.trackIds', async () => {
    playlistDetail.mockResolvedValue({ status: 200, body: { code: 200 } })
    const { fetchPlaylistSongs } = await import('./netease')

    await expect(fetchPlaylistSongs(100, undefined, 'cookie')).rejects.toThrow('playlist.trackIds')
    expect(songDetail).not.toHaveBeenCalled()
  })
})
