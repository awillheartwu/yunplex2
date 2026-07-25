import { describe, expect, it } from 'vitest'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { configureResolver } from './artist-resolver'
import { buildCachedTargetOrder, validateCachedTargetOrder } from './reorder-cache'

configureResolver({ enableMB: false })

function song(id: number, name: string, artist = 'Artist', album = 'Album'): NeteaseSong {
  return {
    id,
    name,
    no: 1,
    dt: 1000,
    disc: '1',
    artists: [{ name: artist }],
    album: { id: 1, name: album, picUrl: '', publishTime: 0 },
  }
}

function track(ratingKey: string, title: string, artist = 'Artist', album = 'Album'): PlexTrack {
  return { ratingKey, title, grandparentTitle: artist, parentTitle: album }
}

describe('buildCachedTargetOrder', () => {
  it('returns ordered rating keys when cache is complete', () => {
    const result = buildCachedTargetOrder(
      [11, 22, 33],
      new Map([
        [11, 'rk-1'],
        [22, 'rk-2'],
        [33, 'rk-3'],
      ]),
    )

    expect(result).toEqual(['rk-1', 'rk-2', 'rk-3'])
  })

  it('returns null when any cache entry is missing', () => {
    const result = buildCachedTargetOrder(
      [11, 22, 33],
      new Map([
        [11, 'rk-1'],
        [33, 'rk-3'],
      ]),
    )

    expect(result).toBeNull()
  })

  it('validates every cached Plex rating key before using pure reorder', async () => {
    const result = await validateCachedTargetOrder(
      [song(11, 'A'), song(22, 'B')],
      new Map([[11, 'rk-1'], [22, 'rk-2']]),
      async (ratingKey) => ratingKey === 'rk-1'
        ? track('rk-1', 'A')
        : track('rk-2', 'B'),
    )

    expect(result.targetOrder).toEqual(['rk-1', 'rk-2'])
    expect(result.issues).toEqual([])
  })

  it('rejects pure reorder when a cached rating key no longer exists', async () => {
    const result = await validateCachedTargetOrder(
      [song(11, 'A')],
      new Map([[11, 'rk-1']]),
      async () => null,
    )

    expect(result.targetOrder).toBeNull()
    expect(result.issues).toEqual([{ songId: 11, ratingKey: 'rk-1', reason: 'missing_plex_track' }])
  })

  it('rejects pure reorder when a cached rating key points to a different song', async () => {
    const result = await validateCachedTargetOrder(
      [song(11, 'A')],
      new Map([[11, 'rk-1']]),
      async () => track('rk-1', 'Different'),
    )

    expect(result.targetOrder).toBeNull()
    expect(result.issues[0]).toMatchObject({
      songId: 11,
      ratingKey: 'rk-1',
      reason: 'metadata_mismatch',
      titleMatched: false,
    })
  })

  it('accepts a durable path identity when Plex metadata drifted', async () => {
    const result = await validateCachedTargetOrder(
      [song(11, '温室', '灯诱LampLure', '人生逃避號')],
      new Map([[11, 'rk-1']]),
      async () => ({
        ...track('rk-1', '温室;温室', 'Various Artists', '[Unknown Album]'),
        Media: [{ Part: [{ file: '/volume1/06_Music/灯诱LampLure/人生逃避號/02 - 温室.flac' }] }],
      }),
      new Map([[11, '/volume1/06_Music/灯诱LampLure/人生逃避號/02 - 温室.flac']]),
    )
    expect(result.targetOrder).toEqual(['rk-1'])
    expect(result.issues).toEqual([])
  })

  it('validates a durable identity against every Plex media part', async () => {
    const expected = '/volume1/06_Music/Artist/Album/alternate.flac'
    const result = await validateCachedTargetOrder(
      [song(11, 'Song')],
      new Map([[11, 'rk-1']]),
      async () => ({
        ...track('rk-1', 'Drifted', 'Various Artists', '[Unknown Album]'),
        Media: [
          { Part: [{ file: '/volume1/06_Music/Artist/Album/primary.flac' }] },
          { Part: [{ file: expected }] },
        ],
      }),
      new Map([[11, expected]]),
    )

    expect(result.targetOrder).toEqual(['rk-1'])
    expect(result.issues).toEqual([])
  })
})
