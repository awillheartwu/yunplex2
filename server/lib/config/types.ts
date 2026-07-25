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
  plexLibraryPathPrefix: string
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
  activityRetentionDays: number
  forceFullCompare: boolean
  reconcileOnPlexDrift: boolean
  fullCompareAfterSkips: number
  fullCompareAfterDays: number
  autoDownloadAlbum: boolean
  skipPlexPlaylist: boolean
  skipRemoveExtraTracks: boolean
  extraTrackRemovalPolicy: ExtraTrackRemovalPolicy
  enableHighConfidenceMetadataBinding: boolean
  metadataDurationToleranceSec: number
  maxFailureAttempts: number
}

export type ExtraTrackRemovalPolicy = 'strict' | 'balanced' | 'exact'

export type MultiArtistFormat = 'feat' | 'ft' | 'featuring' | 'ampersand' | 'slash' | 'comma' | 'with' | 'and' | 'plus'

export function joinList(names: string[], conjunction: string): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length === 2) return names[0]! + conjunction + names[1]!
  return names.slice(0, -1).join(', ') + conjunction + names[names.length - 1]!
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
  downloadRomajiLyric: boolean
  artistAliases: Record<string, string>
  applyAliasToAlbum: boolean
  pathFormat: string
  fontScale: number
  enableMusicBrainzResolver: boolean
  musicBrainzMinScore: number
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
  section: 'netease' | 'plex' | 'download'
  success: boolean
  message: string
}

export type StorageVisibilityStatus = 'verified' | 'warning'

export type StorageVisibilityCode =
  | 'shared_storage_verified'
  | 'remote_storage_unverified'
  | 'mapping_only_unverified'
  | 'missing_path_prefix'
  | 'section_prefix_mismatch'
  | 'section_location_unavailable'
  | 'plex_inspection_unavailable'
  | 'path_mapping_invalid'

export interface PlexMusicSectionInfo {
  key: string
  title: string
  locations: string[]
}

export interface StorageMappingSample {
  relativePath: string
  localPath: string
  plexPath: string | null
  roundTripLocalPath: string | null
  roundTripMatches: boolean
}

export interface StorageVisibilityCheck {
  key: 'mapping' | 'section' | 'publication'
  label: string
  status: 'pass' | 'warning'
  detail: string
}

/**
 * Storage visibility is intentionally a warning-level diagnostic. A valid path
 * substitution proves naming equivalence only; it cannot upload a file or prove
 * that a different Plex host is backed by the same physical storage.
 */
export interface StorageVisibilityDiagnostic {
  status: StorageVisibilityStatus
  code: StorageVisibilityCode
  summary: string
  action: string
  publicationVerified: boolean
  mappingValid: boolean
  serverScope: 'local' | 'remote' | 'unknown'
  downloadDir: string
  plexPathPrefix: string | null
  sectionName: string
  sectionKey: string | null
  sectionLocations: string[]
  prefixMatchesSection: boolean | null
  inspectionError?: string
  sample: StorageMappingSample
  checks: StorageVisibilityCheck[]
}
