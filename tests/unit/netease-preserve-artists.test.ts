import { afterEach, describe, expect, it } from 'vitest'
import { getArtistAliases, mapRawSong, setArtistAliases } from '../../server/lib/netease'

const rawSong = {
  id: 42,
  name: 'Song',
  no: 1,
  dt: 180000,
  cd: '1',
  ar: [{ id: 1, name: '原艺人' }],
  al: { id: 7, name: 'Album', picUrl: '', artist: { id: 1, name: '原艺人' } },
}

afterEach(() => setArtistAliases({}, false))

describe('mapRawSong artist preservation', () => {
  it('keeps default alias mapping while preserving raw artist names on request', () => {
    setArtistAliases({ '原艺人': '全局别名' }, true)

    const before = getArtistAliases()
    const mapped = mapRawSong(rawSong)
    const preserved = mapRawSong(rawSong, { preserveArtistNames: true })

    expect(mapped.artists).toEqual([{ id: 1, name: '全局别名' }])
    expect(mapped.album.artist).toEqual({ id: 1, name: '全局别名' })
    expect(preserved.artists).toEqual([{ id: 1, name: '原艺人' }])
    expect(preserved.album.artist).toEqual({ id: 1, name: '原艺人' })
    expect(getArtistAliases()).toEqual(before)
    expect(mapRawSong(rawSong).artists[0]?.name).toBe('全局别名')
  })
})
