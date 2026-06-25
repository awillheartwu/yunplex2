import { describe, expect, it } from 'vitest'
import { mapPlexPathToLocal, normalizePathPrefix } from './path-map'
import type { AppConfig } from '../config/types'

const cfg: AppConfig = {
  netease: { cookie: '', quality: 'jymaster' },
  plex: { server: '', port: 32400, token: '', section: '音乐' },
  download: {
    dir: '/app/downloads/music',
    plexLibraryPathPrefix: '/music',
    downloadLyrics: true,
    embedMetadata: true,
    embedCover: true,
    saveAlbumCover: false,
    saveArtistImage: false,
  },
  sync: {
    intervalMinutes: 30,
    songLimit: 10,
    downloadConcurrency: 3,
    plexScanRetries: 5,
    plexScanRetryDelaySec: 15,
    enabled: false,
    logRetentionDays: 30,
    jobRetentionSuccessDays: 7,
    jobRetentionFailedDays: 90,
    downloadTaskRetentionDays: 30,
    activityRetentionDays: 30,
    forceFullCompare: false,
    fullCompareAfterSkips: 5,
    fullCompareAfterDays: 7,
    autoDownloadAlbum: false,
    skipPlexPlaylist: false,
    skipRemoveExtraTracks: false,
    maxFailureAttempts: 3,
  },
  other: {
    multiArtistFormat: 'ampersand',
    lyricOrder: 'original_first',
    downloadTranslatedLyric: true,
    downloadRomajiLyric: false,
    artistAliases: {},
    applyAliasToAlbum: false,
    pathFormat: '{artist}/{album}/{title}',
    fontScale: 1,
    enableMusicBrainzResolver: true,
    musicBrainzMinScore: 90,
  },
}

describe('path mapping', () => {
  it('normalizes prefixes by trimming trailing separators', () => {
    expect(normalizePathPrefix('/music///')).toBe('/music')
  })

  it('maps plex media path to local download directory', () => {
    const mapped = mapPlexPathToLocal('/music/Jay/Album/01.mp3', cfg)
    expect(mapped).toBe('/app/downloads/music/Jay/Album/01.mp3')
  })

  it('returns null when plex path does not match configured prefix', () => {
    const mapped = mapPlexPathToLocal('/other/Jay/Album/01.mp3', cfg)
    expect(mapped).toBeNull()
  })
})
