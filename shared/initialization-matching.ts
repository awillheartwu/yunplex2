/** Candidate planning only. These settings never authorize a media binding. */
export interface MatchingAlias {
  name: string
  aliases: string[]
  enabled: boolean
}

export interface InitializationMatchingConfig {
  enabled: boolean
  foldChinese: boolean
  normalizeTypography: boolean
  foldArtistDiacritics: boolean
  corroboratedBilingualTitles: boolean
  ignoreContextNotes: boolean
  bilingualTitles: boolean
  fuzzyTitles: boolean
  supplementalTitleRecall: boolean
  metadataFallback: boolean
  corroboratedRecommendations: boolean
  preferExactAlbum: boolean
  duplicatePolicy: 'review' | 'highest_quality'
  ignoreMissingCollaborators: boolean
  musicBrainzAliases: boolean
  musicBrainzMinScore: number
  musicBrainzMaxArtists: number
  useTrackArtist: boolean
  useArtistAliases: boolean
  artistPolicy: 'complete' | 'primary'
  usePathHints: boolean
  albumPolicy: 'require' | 'prefer' | 'ignore'
  trackPolicy: 'require' | 'prefer' | 'ignore'
  recommendDurationMs: number
  reviewDurationMs: number
  recommendDurationPercent: number
  missingDuration: 'exclude' | 'review'
  remasterPolicy: 'strict' | 'review' | 'allow'
  editionPolicy: 'strict' | 'review'
  explicitPolicy: 'strict' | 'review'
  showVersionConflicts: boolean
  unknownVersion: 'exclude' | 'review'
  preferLossless: boolean
  preferredDirectory: string
  artistAliases: MatchingAlias[]
  titleAliases: MatchingAlias[]
}

export const DEFAULT_INITIALIZATION_MATCHING: InitializationMatchingConfig = {
  enabled: false, foldChinese: true, normalizeTypography: true,
  foldArtistDiacritics: false, corroboratedBilingualTitles: false,
  ignoreContextNotes: true, bilingualTitles: true, fuzzyTitles: false,
  supplementalTitleRecall: true, metadataFallback: true,
  corroboratedRecommendations: true, preferExactAlbum: true,
  duplicatePolicy: 'highest_quality', ignoreMissingCollaborators: false,
  musicBrainzAliases: false, musicBrainzMinScore: 100, musicBrainzMaxArtists: 40,
  useTrackArtist: true, useArtistAliases: true, artistPolicy: 'complete', usePathHints: true,
  albumPolicy: 'prefer', trackPolicy: 'prefer', recommendDurationMs: 2000,
  reviewDurationMs: 5000, recommendDurationPercent: 2, missingDuration: 'review',
  remasterPolicy: 'review', editionPolicy: 'review', explicitPolicy: 'strict',
  showVersionConflicts: true, unknownVersion: 'review', preferLossless: true,
  preferredDirectory: '', artistAliases: [], titleAliases: [],
}

export type MatchingPreset = 'conservative' | 'balanced' | 'discovery'
export function matchingPreset(preset: MatchingPreset): InitializationMatchingConfig {
  const config = structuredClone(DEFAULT_INITIALIZATION_MATCHING)
  config.enabled = true
  if (preset === 'conservative') Object.assign(config, {
    duplicatePolicy: 'review', ignoreContextNotes: false, bilingualTitles: false, supplementalTitleRecall: false, metadataFallback: false, corroboratedRecommendations: false, preferExactAlbum: false, usePathHints: false,
    albumPolicy: 'require', trackPolicy: 'require', reviewDurationMs: 3000,
    remasterPolicy: 'strict', editionPolicy: 'strict', unknownVersion: 'exclude',
  })
  if (preset === 'discovery') Object.assign(config, {
    fuzzyTitles: true, supplementalTitleRecall: true, metadataFallback: true, artistPolicy: 'primary', reviewDurationMs: 10000,
    explicitPolicy: 'review',
  })
  return config
}

export interface MatchingCounts {
  preserved: number
  strong: number
  recommended: number
  review: number
  duplicates: number
  versionConflicts: number
  identityConflicts: number
  unmatched: number
  metadataMissing: number
}

export interface MatchingPreviewItem {
  songId: number
  title: string
  artists: string[]
  before: string
  after: string
  change: 'added' | 'downgraded' | 'candidate_changed' | 'changed' | 'unchanged'
  candidate: { ratingKey: string; title: string; artist: string; album: string; filePath: string | null; durationMs: number | null } | null
  candidates: Array<{ ratingKey: string; title: string; artist: string; album: string; filePath: string | null; durationMs: number | null }>
  reasons: string[]
  conflicts: string[]
}

export interface MatchingPreviewResult {
  snapshotId: string
  capturedAt: string
  expiresAt: string
  sourceId: string
  sourceName: string
  total: number
  trackCount: number
  configFingerprint: string
  before: MatchingCounts
  after: MatchingCounts
  items: MatchingPreviewItem[]
  musicBrainz?: MusicBrainzMatchingEvidence
  aliasSuggestions: Array<MatchingAlias & { count: number; examples: string[] }>
}

export interface MusicBrainzMatchingEvidence {
  groups: Array<MatchingAlias & { mbid: string; score: number }>
  queried: number
  skipped: number
  warnings: string[]
}
