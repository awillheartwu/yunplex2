export interface NeteaseConfig {
  cookie: string
  quality: AudioQuality
}

export type AudioQuality =
  | 'standard'
  | 'higher'
  | 'exhigh'
  | 'lossless'
  | 'hires'
  | 'jyeffect'
  | 'jymaster'

export interface PlexConfig {
  server: string
  port: number
  token: string
  section: string
}

export interface DownloadConfig {
  dir: string
  downloadLyrics: boolean
  embedMetadata: boolean
  embedCover: boolean
  saveAlbumCover: boolean
  saveArtistImage: boolean
}

export interface SyncStrategyConfig {
  intervalMinutes: number
  songLimit: number
  downloadConcurrency: number
  plexScanRetries: number
  plexScanRetryDelaySec: number
  enabled: boolean
  logRetentionDays: number
  jobRetentionSuccessDays: number
  jobRetentionFailedDays: number
  downloadTaskRetentionDays: number
  downloadHistoryRetentionDays: number
  forceFullCompare: boolean
  fullCompareAfterSkips: number
  fullCompareAfterDays: number
}

export type MultiArtistFormat = 'feat' | 'ft' | 'featuring' | 'ampersand' | 'slash' | 'comma' | 'with' | 'and' | 'plus'

export function joinList(names: string[], conjunction: string): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return names[0] + conjunction + names[1]
  return names.slice(0, -1).join(', ') + conjunction + names[names.length - 1]
}

/**
 * Format N artist names into a track-artist string.
 * 2 artists   | 3+ artists
 * A feat. B   | A feat. B, C & D
 * A & B       | A, B & C
 * A / B       | A / B / C
 * A, B        | A, B, C
 */
export function formatTrackArtist(names: string[], format: MultiArtistFormat): string {
  if (names.length <= 1) return names.join('')
  switch (format) {
    case 'feat':      return names[0] + ' feat. ' + joinList(names.slice(1), ' & ')
    case 'ft':        return names[0] + ' ft. ' + joinList(names.slice(1), ' & ')
    case 'featuring': return names[0] + ' featuring ' + joinList(names.slice(1), ' & ')
    case 'with':      return names[0] + ' with ' + joinList(names.slice(1), ' & ')
    case 'ampersand': return joinList(names, ' & ')
    case 'and':       return joinList(names, ' and ')
    case 'comma':     return names.join(', ')
    case 'slash':     return names.join(' / ')
    case 'plus':      return names.join(' + ')
  }
}

export type LyricOrder = 'original_first' | 'translated_first' | 'separate'

export const PATH_PRESETS: { value: string; label: string }[] = [
  { value: '{artist}/{album} ({year})/{title}', label: '歌手/专辑 (年份)/歌名' },
  { value: '{artist}/{album} ({year})/{artist} - {title}', label: '歌手/专辑 (年份)/歌手 - 歌名' },
  { value: '{artist}/{album} ({year})/{track:02d} - {artist} - {title}', label: '歌手/专辑 (年份)/曲目 - 歌手 - 歌名' },
  { value: '{artist}/{album} ({year})/{track:02d} - {title}', label: '歌手/专辑 (年份)/曲目 - 歌名' },
  { value: '{artist}/{album} ({year})/{track:02d}. {title}', label: '歌手/专辑 (年份)/曲目. 歌名' },
  { value: '{artist}/{album}/{title}', label: '歌手/专辑/歌名 (无年份)' },
  { value: '{artist} - {album} ({year})/{track:02d} - {title}', label: '歌手 - 专辑 (年份)/曲目 - 歌名' },
  { value: '{artist}/{year} - {album}/{track:02d}. {title}', label: '歌手/年份 - 专辑/曲目. 歌名' },
]

export interface OtherConfig {
  multiArtistFormat: MultiArtistFormat
  lyricOrder: LyricOrder
  downloadTranslatedLyric: boolean
  pathFormat: string
  fontScale: number
}

export interface AppConfig {
  netease: NeteaseConfig
  plex: PlexConfig
  download: DownloadConfig
  sync: SyncStrategyConfig
  other: OtherConfig
}

export type ConfigSection = keyof AppConfig

export interface ConnectionTestResult {
  section: 'netease' | 'plex'
  success: boolean
  message: string
}
