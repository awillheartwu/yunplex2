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
  /** Global default score line for quick initialization previews; new previews only, never existing drafts. */
  quickMatchThreshold: number
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
  reviewDurationMs: 5000, recommendDurationPercent: 2, quickMatchThreshold: 85,
  missingDuration: 'review',
  remasterPolicy: 'review', editionPolicy: 'review', explicitPolicy: 'strict',
  showVersionConflicts: true, unknownVersion: 'review', preferLossless: true,
  preferredDirectory: '', artistAliases: [], titleAliases: [],
}

export type MatchingPreset = 'conservative' | 'balanced' | 'discovery'
export const MATCHING_PRESETS: readonly MatchingPreset[] = ['conservative', 'balanced', 'discovery']
/** Presets never own the user's dictionaries or quick-preview tuning. */
export const MATCHING_PRESET_EXCLUDED_FIELDS = ['artistAliases', 'titleAliases', 'preferredDirectory', 'quickMatchThreshold'] as const
export type MatchingPresetField = Exclude<keyof InitializationMatchingConfig, typeof MATCHING_PRESET_EXCLUDED_FIELDS[number]>
/** Derived from the defaults so a new algorithm parameter becomes preset-owned by default. */
export const MATCHING_PRESET_FIELDS = (Object.keys(DEFAULT_INITIALIZATION_MATCHING) as Array<keyof InitializationMatchingConfig>)
  .filter((key): key is MatchingPresetField => !(MATCHING_PRESET_EXCLUDED_FIELDS as readonly string[]).includes(key))

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

export type MatchingPresetSelection = MatchingPreset | 'custom'

/** Display and selection only; applying a preset still clones matchingPreset(). */
export function matchingPresetSelection(config: InitializationMatchingConfig): MatchingPresetSelection {
  for (const preset of MATCHING_PRESETS) {
    const candidate = matchingPreset(preset)
    if (MATCHING_PRESET_FIELDS.every(field => config[field] === candidate[field])) return preset
  }
  return 'custom'
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
