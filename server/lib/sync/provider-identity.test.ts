import { describe, expect, it } from 'vitest'
import type { NeteaseSong } from '../netease'
import type { PlexTrackNeteaseIdentity } from '../plex-client'
import { evaluateNeteaseProviderIdentity } from './provider-identity'

const song: NeteaseSong = {
  id: 66285, name: '葡萄成熟时', no: 6, dt: 279846, disc: '1',
  artists: [{ id: 2116, name: '陈奕迅' }],
  album: { id: 6491, name: 'U87', picUrl: '', publishTime: 0 },
}
const identity: PlexTrackNeteaseIdentity = {
  provider: 'wangyiyun', artistId: 2116, albumId: 6491, discNumber: null, trackNumber: 6,
  rawGuid: 'com.plexapp.agents.WangYiYun://2116/6491/-1/6?lang=zh',
}
const track = {
  ratingKey: '35859', title: '葡萄成熟时', grandparentTitle: 'Eason Chan', parentTitle: 'U87',
  index: 6, duration: 279846,
}

describe('NetEase provider identity evidence', () => {
  it('matches typed IDs despite a translated Plex display artist', () => {
    expect(evaluateNeteaseProviderIdentity(song, track, identity, 2000)).toMatchObject({
      matched: true, titleMatched: true, duration: { matched: true, deltaMs: 0 }, failureReasons: [],
    })
  })

  it.each([
    [{ ...identity, artistId: 999 }, 'artist_id_mismatch'],
    [{ ...identity, albumId: 999 }, 'album_id_mismatch'],
    [{ ...identity, trackNumber: 7 }, 'track_number_mismatch'],
  ] as const)('rejects a conflicting provider identity', (candidateIdentity, reason) => {
    const result = evaluateNeteaseProviderIdentity(song, track, candidateIdentity, 2000)
    expect(result.matched).toBe(false)
    expect(result.failureReasons).toContain(reason)
  })
})
