import { describe, expect, it } from 'vitest'
import { mapLocalPathToPlex, mapPlexPathToLocal, normalizePathPrefix } from '~~/server/lib/sync/path-map'
import type { AppConfig } from '~~/server/lib/config/types'

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
    jobRetentionFailedDays: 30,
    downloadTaskRetentionDays: 30,
    forceFullCompare: false,
    reconcileOnPlexDrift: true,
    fullCompareAfterSkips: 5,
    fullCompareAfterDays: 7,
    autoDownloadAlbum: false,
    skipPlexPlaylist: false,
    skipRemoveExtraTracks: false,
    extraTrackRemovalPolicy: 'balanced',
    maxFailureAttempts: 3,
    unverifiedMediaPolicy: 'download_managed',
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

  it('maps a local download path back to the Plex library path', () => {
    const mapped = mapLocalPathToPlex('/app/downloads/music/Jay/Album/01.mp3', cfg)
    expect(mapped).toBe('/music/Jay/Album/01.mp3')
  })

  it('refuses to map paths outside the configured download root', () => {
    expect(mapLocalPathToPlex('/tmp/Jay/Album/01.mp3', cfg)).toBeNull()
  })
})
