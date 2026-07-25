import { describe, expect, it } from 'vitest'
import {
  getPlexTrackNeteaseIdentity,
  getPlexTrackMusicBrainzIdentity,
  getPlexTrackRecordingId,
  type PlexTrack,
} from './plex-client'

function track(guids: string[]): PlexTrack {
  return {
    ratingKey: '1',
    title: 'Track',
    grandparentTitle: 'Artist',
    parentTitle: 'Album',
    Guid: guids.map(id => ({ id })),
  }
}

describe('Plex MusicBrainz identity parsing', () => {
  it('keeps generic mbid URIs untyped instead of mislabelling release-track IDs as recordings', () => {
    const input = track(['mbid://8220c472-146e-4a9e-a71e-fd8beb603e14'])

    expect(getPlexTrackMusicBrainzIdentity(input)).toEqual({
      explicitRecordingId: null,
      untypedIds: ['8220c472-146e-4a9e-a71e-fd8beb603e14'],
      rawGuids: ['mbid://8220c472-146e-4a9e-a71e-fd8beb603e14'],
    })
    expect(getPlexTrackRecordingId(input)).toBeNull()
  })

  it('accepts only explicitly typed recording GUIDs as direct recording evidence', () => {
    const input = track([
      'mbid://recording/1cdb1f16-31e5-4765-af6e-c3c02386dcc4',
      'https://musicbrainz.org/recording/48a7d7c0-4da7-40ce-bb9d-50026bec4d53',
    ])

    expect(getPlexTrackMusicBrainzIdentity(input)).toMatchObject({
      explicitRecordingId: '1cdb1f16-31e5-4765-af6e-c3c02386dcc4',
      untypedIds: [],
    })
    expect(getPlexTrackRecordingId(input)).toBe('1cdb1f16-31e5-4765-af6e-c3c02386dcc4')
  })

  it('deduplicates IDs from legacy guid and modern Guid fields while preserving evidence', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const input = { ...track([`mbid://${id}`, `mbid://${id}`]), guid: `mbid://${id}` }

    expect(getPlexTrackMusicBrainzIdentity(input)).toEqual({
      explicitRecordingId: null,
      untypedIds: [id],
      rawGuids: [`mbid://${id}`],
    })
  })
})

describe('Plex NetEase provider identity parsing', () => {
  it('extracts typed artist, album, optional disc and track identifiers', () => {
    expect(getPlexTrackNeteaseIdentity({
      ...track([]),
      guid: 'com.plexapp.agents.WangYiYun://2116/6491/-1/6?lang=zh',
    })).toEqual({
      provider: 'wangyiyun', artistId: 2116, albumId: 6491,
      discNumber: null, trackNumber: 6,
      rawGuid: 'com.plexapp.agents.WangYiYun://2116/6491/-1/6?lang=zh',
    })
  })

  it('rejects malformed or unrelated provider GUIDs', () => {
    expect(getPlexTrackNeteaseIdentity({
      ...track([]), guid: 'com.plexapp.agents.WangYiYun://2116/6491',
    })).toBeNull()
    expect(getPlexTrackNeteaseIdentity({ ...track([]), guid: 'local://123' })).toBeNull()
  })
})
