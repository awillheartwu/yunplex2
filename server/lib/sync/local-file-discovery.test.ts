import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import { findExistingLocalSongPath } from './local-file-discovery'

function buildConfig(downloadDir: string): AppConfig {
  return {
    netease: { cookie: '', quality: 'jymaster' },
    plex: { server: '', port: 32400, token: '', section: '音乐' },
    download: {
      dir: downloadDir,
      plexLibraryPathPrefix: '/volume1/06_Music',
      downloadLyrics: true,
      embedMetadata: true,
      embedCover: true,
      saveAlbumCover: true,
      saveArtistImage: true,
    },
    sync: {
      intervalMinutes: 30,
      songLimit: 0,
      downloadConcurrency: 3,
      plexScanRetries: 5,
      plexScanRetryDelaySec: 15,
      enabled: true,
      logRetentionDays: 30,
      jobRetentionSuccessDays: 7,
      jobRetentionFailedDays: 30,
      downloadTaskRetentionDays: 30,
      forceFullCompare: false,
      downloadWhenMediaMissing: false,
      reconcileOnPlexDrift: true,
      fullCompareAfterSkips: 5,
      fullCompareAfterDays: 7,
      autoDownloadAlbum: true,
      skipPlexPlaylist: false,
      skipRemoveExtraTracks: false,
      extraTrackRemovalPolicy: 'balanced',
      maxFailureAttempts: 1,
    },
    other: {
      multiArtistFormat: 'ampersand',
      lyricOrder: 'translated_first',
      downloadTranslatedLyric: true,
      downloadRomajiLyric: true,
      artistAliases: {},
      applyAliasToAlbum: true,
      pathFormat: '{artist}/{album} ({year})/{track:02d} - {title}',
      fontScale: 1,
      enableMusicBrainzResolver: true,
      musicBrainzMinScore: 90,
    },
  }
}

const song: NeteaseSong = {
  id: 1888390721,
  name: '艾蜜莉',
  no: 9,
  dt: 0,
  disc: '1',
  artists: [{ name: '回春丹' }],
  album: {
    id: 1,
    name: '耳鬼出风',
    picUrl: '',
    publishTime: new Date('2021-01-01T00:00:00.000Z').getTime(),
  },
}

describe('local file discovery', () => {
  it('re-discovers an existing local file even when lookup cache is empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'yunplex-local-discovery-'))
    const filePath = join(root, '回春丹', '耳鬼出风 (2021)', '09 - 艾蜜莉 [netease-1888390721].flac')
    mkdirSync(join(root, '回春丹', '耳鬼出风 (2021)'), { recursive: true })
    writeFileSync(filePath, 'stub')

    expect(findExistingLocalSongPath(song, buildConfig(root))).toBe(filePath)
  })
})
