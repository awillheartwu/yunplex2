import type { AppConfig } from './types'

export const DEFAULT_CONFIG: AppConfig = {
  netease: {
    cookie: '',
    playlistIds: [],
    quality: 'jymaster',
  },
  plex: {
    server: '',
    port: 32400,
    token: '',
    section: '音乐',
  },
  download: {
    dir: '/mnt/nas',
    downloadLyrics: true,
    embedMetadata: true,
    embedCover: true,
    saveAlbumCover: false,
    saveArtistImage: false,
  },
  sync: {
    intervalMinutes: 30,
    songLimit: 10,
    enabled: false,
    logRetentionDays: 30,
    jobRetentionSuccessDays: 7,
    jobRetentionFailedDays: 90,
  },
  other: {
    multiArtistFormat: 'ampersand',
    lyricOrder: 'original_first',
    downloadTranslatedLyric: true,
    pathFormat: '{artist}/{album}/{title}',
  },
}
