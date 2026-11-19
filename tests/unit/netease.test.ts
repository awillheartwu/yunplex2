import { describe, it, expect } from 'vitest'
import { mapRawSong } from '../../server/lib/netease'

describe('mapRawSong', () => {
  it('maps full data with all fields', () => {
    const raw = {
      id: 123456,
      name: 'Song Name',
      no: 5,
      dt: 245000,
      cd: '2',
      publishTime: 1700000000000,
      ar: [{ name: 'Artist A' }, { name: 'Artist B' }],
      al: {
        id: 999,
        name: 'Album Name',
        picUrl: 'https://example.com/cover.jpg',
        publishTime: 1690000000000,
        artist: { name: 'Artist A' },
      },
    }
    const result = mapRawSong(raw)
    expect(result.id).toBe(123456)
    expect(result.name).toBe('Song Name')
    expect(result.no).toBe(5)
    expect(result.dt).toBe(245000)
    expect(result.disc).toBe('2')
    expect(result.artists).toEqual([{ name: 'Artist A' }, { name: 'Artist B' }])
    expect(result.album.id).toBe(999)
    expect(result.album.name).toBe('Album Name')
    expect(result.album.picUrl).toBe('https://example.com/cover.jpg')
    expect(result.album.publishTime).toBe(1700000000000)
  })

  it('falls back to album-level publishTime', () => {
    const raw = {
      id: 1,
      name: 'Song',
      no: 1,
      dt: 1000,
      cd: '1',
      ar: [{ name: 'X' }],
      al: {
        id: 1,
        name: 'Album',
        picUrl: '',
        publishTime: 1690000000000,
      },
    }
    const result = mapRawSong(raw)
    expect(result.album.publishTime).toBe(1690000000000)
  })

  it('defaults publishTime to 0 when missing at both levels', () => {
    const raw = {
      id: 1,
      name: 'Song',
      no: 1,
      dt: 1000,
      cd: '1',
      ar: [{ name: 'X' }],
      al: { id: 1, name: 'Album', picUrl: '' },
    }
    const result = mapRawSong(raw)
    expect(result.album.publishTime).toBe(0)
  })

  it('defaults artists to empty array when ar is undefined', () => {
    const raw = {
      id: 1,
      name: 'Song',
      no: 1,
      dt: 1000,
      cd: '1',
      al: { id: 1, name: 'Album', picUrl: '' },
    }
    const result = mapRawSong(raw)
    expect(result.artists).toEqual([])
  })

  it('defaults album when al is undefined', () => {
    const raw = {
      id: 1,
      name: 'Song',
      no: 1,
      dt: 1000,
      cd: '1',
    }
    const result = mapRawSong(raw)
    expect(result.album.id).toBe(0)
    expect(result.album.name).toBe('未知专辑')
    expect(result.album.picUrl).toBe('')
  })

  it('defaults cd to "1" when absent', () => {
    const raw = {
      id: 1,
      name: 'Song',
      no: 1,
      dt: 1000,
      al: { id: 1, name: 'Album', picUrl: '' },
    }
    const result = mapRawSong(raw)
    expect(result.disc).toBe('1')
  })

  it('defaults no and dt to 0 when absent', () => {
    const raw = {
      id: 1,
      name: 'Song',
      al: { id: 1, name: 'Album', picUrl: '' },
    }
    const result = mapRawSong(raw)
    expect(result.no).toBe(0)
    expect(result.dt).toBe(0)
  })
})
