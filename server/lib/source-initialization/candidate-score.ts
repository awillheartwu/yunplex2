import type { InitializationMatchingConfig } from '../../../shared/initialization-matching'
import type { CandidateScore, CandidateScoreParts } from '../../../shared/initialization-scoring'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { artistCreditKeys } from './artist-credits'
import { aliasKeys, matchingKey, titleParts, versionEvidence, type TitleParts } from './matching-normalization'

/**
 * Pure candidate scoring for initialization review.
 *
 * The score ranks metadata agreement; it never authorizes a media binding.
 * Shared-media ownership conflicts are resolved by the analysis engine, not
 * here.
 */
export const CANDIDATE_SCORE_WEIGHTS = { title: 35, artists: 35, duration: 20, album: 7, track: 3 } as const
export const VERSION_REVIEW_PENALTY = 10
export const VERSION_REVIEW_PENALTY_CAP = 30
/** Duration similarity falls back to 2% of the target length. */
export const DURATION_FALLBACK_RATIO = 0.02
export const BILINGUAL_TITLE_STRENGTH = 0.9
export const SUPPLEMENTAL_TITLE_STRENGTH = 0.8
export const FUZZY_TITLE_CAP = 0.7
export const BILINGUAL_DURATION_WINDOW_MS = 500

/** Stable machine codes for `blocked`; readable detail stays in `risks`. */
export const CANDIDATE_SCORE_BLOCKS = {
  versionExcluded: 'version-excluded',
  versionConflict: 'version-conflict',
  foreignNeteaseId: 'foreign-netease-id',
  pathsMissing: 'paths-missing',
  pathsNotUnique: 'paths-not-unique',
  durationWindow: 'duration-window',
  artistMismatch: 'artist-mismatch',
  albumRequired: 'album-required',
  trackRequired: 'track-required',
  missingDuration: 'missing-duration',
} as const

/** Placeholder credits such as compilations never prove a different artist. */
const UNKNOWN_ARTISTS = ['Various Artists', 'Various', 'VA', '群星', '合辑', '未知艺人', '佚名', 'Unknown Artist', 'Unknown']

export function scoreCandidate(song: NeteaseSong, track: PlexTrack, config: InitializationMatchingConfig): CandidateScore {
  const blocked: string[] = []
  const risks: string[] = []
  const songTitle = titleParts(song.name, config)
  const trackTitle = titleParts(track.title || '', config)
  const version = versionEvidence(songTitle, trackTitle, config)
  const delta = song.dt > 0 && Number(track.duration) > 0 ? Math.abs(song.dt - Number(track.duration)) : null
  const songAlbumKey = matchingKey(song.album.name || '', config)
  const trackAlbumKey = matchingKey(track.parentTitle || '', config)
  const albumExact = Boolean(songAlbumKey) && songAlbumKey === trackAlbumKey
  const trackIndex = Number(track.index)
  const numberKnown = song.no > 0 && Number.isInteger(trackIndex) && trackIndex > 0
  const numberEqual = numberKnown && trackIndex === song.no
  const artist = artistEvidence(song, track, songTitle, trackTitle, config)
  const title = titleEvidence(song, track, songTitle, trackTitle, config, {
    completeArtists: artist.complete, albumExact, numberEqual, delta,
  })
  // Missing metadata loses its points but never renormalizes the 100-point scale.
  const duration = delta === null
    ? 0
    : Math.max(0, 1 - delta / Math.max(config.reviewDurationMs, song.dt * DURATION_FALLBACK_RATIO))
  const parts: CandidateScoreParts = {
    title: title.strength * CANDIDATE_SCORE_WEIGHTS.title,
    artists: artist.strength * CANDIDATE_SCORE_WEIGHTS.artists,
    duration: duration * CANDIDATE_SCORE_WEIGHTS.duration,
    album: albumExact ? CANDIDATE_SCORE_WEIGHTS.album : 0,
    track: albumExact && numberEqual ? CANDIDATE_SCORE_WEIGHTS.track : 0,
  }
  const penalty = Math.min(VERSION_REVIEW_PENALTY_CAP, version.review.length * VERSION_REVIEW_PENALTY)
  for (const label of version.review) addOnce(risks, `version-review:${label}`)

  if (version.excluded) addOnce(blocked, CANDIDATE_SCORE_BLOCKS.versionExcluded)
  if (version.conflicts.length) addOnce(blocked, CANDIDATE_SCORE_BLOCKS.versionConflict)

  const paths = track.Media?.flatMap(media => media.Part?.flatMap(part => part.file ? [part.file] : []) ?? []) ?? []
  if (!paths.length) addOnce(blocked, CANDIDATE_SCORE_BLOCKS.pathsMissing)
  else if (paths.length > 1) addOnce(blocked, CANDIDATE_SCORE_BLOCKS.pathsNotUnique)
  if (paths.some(path => [...path.matchAll(/\[netease-(\d+)\]/gi)].some(match => Number(match[1]) !== song.id))) {
    addOnce(blocked, CANDIDATE_SCORE_BLOCKS.foreignNeteaseId)
  }

  if (delta !== null && delta > Math.max(config.reviewDurationMs, song.dt * DURATION_FALLBACK_RATIO)) addOnce(blocked, CANDIDATE_SCORE_BLOCKS.durationWindow)
  if (artist.mismatch) addOnce(blocked, CANDIDATE_SCORE_BLOCKS.artistMismatch)
  if (config.albumPolicy === 'require' && !albumExact) addOnce(blocked, CANDIDATE_SCORE_BLOCKS.albumRequired)
  if (config.trackPolicy === 'require' && !numberEqual) addOnce(blocked, CANDIDATE_SCORE_BLOCKS.trackRequired)
  if (delta === null && config.missingDuration === 'exclude') addOnce(blocked, CANDIDATE_SCORE_BLOCKS.missingDuration)

  if (delta === null && config.missingDuration !== 'exclude') addOnce(risks, 'missing-duration')
  if (!songAlbumKey || !trackAlbumKey) addOnce(risks, 'missing-album')
  else if (!albumExact) addOnce(risks, 'album-mismatch')
  if (!numberKnown) addOnce(risks, 'missing-track-number')
  else if (!numberEqual) addOnce(risks, 'track-mismatch')
  if (artist.missing) addOnce(risks, 'missing-artists')
  else {
    if (artist.matchedWeight < artist.totalWeight) addOnce(risks, 'incomplete-artists')
    if (artist.extra.length) addOnce(risks, `extra-artists:${artist.extra.length}`)
  }
  if (title.fuzzy) addOnce(risks, 'fuzzy-title-match')

  const coverage = (
    (Boolean(song.name.trim()) && Boolean((track.title || '').trim()) ? CANDIDATE_SCORE_WEIGHTS.title : 0)
    + (!artist.missing ? CANDIDATE_SCORE_WEIGHTS.artists : 0)
    + (delta !== null ? CANDIDATE_SCORE_WEIGHTS.duration : 0)
    + (songAlbumKey && trackAlbumKey ? CANDIDATE_SCORE_WEIGHTS.album : 0)
    + (numberKnown ? CANDIDATE_SCORE_WEIGHTS.track : 0)
  ) / 100

  return {
    version: 1,
    total: Math.max(0, parts.title + parts.artists + parts.duration + parts.album + parts.track - penalty),
    eligible: blocked.length === 0,
    parts,
    coverage,
    blocked,
    risks,
    durationDeltaMs: delta,
    completeArtists: artist.complete,
    titleStrength: title.strength,
  }
}

interface TitleEvidence { strength: number; fuzzy: boolean }

function titleEvidence(song: NeteaseSong, track: PlexTrack, songTitle: TitleParts, trackTitle: TitleParts, config: InitializationMatchingConfig,
  corroborated: { completeArtists: boolean; albumExact: boolean; numberEqual: boolean; delta: number | null }): TitleEvidence {
  const songKeys = new Set([songTitle.core])
  for (const key of aliasKeys(song.name, config.titleAliases, config)) songKeys.add(key)
  const trackAlias = aliasKeys(track.title || '', config.titleAliases, config)
  if (songKeys.has(trackTitle.core) || [...trackAlias].some(key => songKeys.has(key))) return { strength: 1, fuzzy: false }
  const bilingual = config.corroboratedBilingualTitles && config.bilingualTitles
    && trackTitle.variants.some(key => songTitle.variants.includes(key))
    && corroborated.completeArtists && corroborated.albumExact && corroborated.numberEqual
    && corroborated.delta !== null && corroborated.delta <= BILINGUAL_DURATION_WINDOW_MS
  if (bilingual) return { strength: BILINGUAL_TITLE_STRENGTH, fuzzy: false }
  const trackKeys = new Set([...trackTitle.variants, ...trackTitle.supplemental, ...trackAlias])
  if ([...songTitle.variants, ...songTitle.supplemental].some(key => trackKeys.has(key))) {
    return { strength: SUPPLEMENTAL_TITLE_STRENGTH, fuzzy: false }
  }
  if (config.fuzzyTitles) {
    const similarity = normalizedSimilarity(songTitle.core, trackTitle.core)
    if (similarity > 0) return { strength: Math.min(similarity, FUZZY_TITLE_CAP), fuzzy: true }
  }
  return { strength: 0, fuzzy: false }
}

/** 1 - editDistance / maxLength over the normalized title cores. */
function normalizedSimilarity(left: string, right: string): number {
  const a = [...left], b = [...right]
  const length = Math.max(a.length, b.length)
  if (!length) return 0
  let previous = b.map((_value, index) => index + 1)
  previous.unshift(0)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + Number(a[i - 1] !== b[j - 1]))
    }
    previous = row
  }
  return 1 - previous[b.length]! / length
}

interface ArtistEvidence {
  matchedWeight: number
  totalWeight: number
  extra: string[]
  complete: boolean
  strength: number
  missing: boolean
  mismatch: boolean
}

function artistEvidence(song: NeteaseSong, track: PlexTrack, songTitle: TitleParts, trackTitle: TitleParts, config: InitializationMatchingConfig): ArtistEvidence {
  const names = [...new Set(song.artists.map(artist => artist.name).filter(Boolean))]
  const desired = names.map(name => aliasKeys(name, config.useArtistAliases ? config.artistAliases : [], config, true))
  for (const key of artistCreditKeys(songTitle.contributors, desired, config)) {
    if (!desired.some(group => group.has(key))) desired.push(new Set([key]))
  }
  const artistText = config.useTrackArtist && track.originalTitle ? track.originalTitle : track.grandparentTitle || ''
  const actual = artistCreditKeys([artistText, ...trackTitle.contributors], desired, config)
  // The target's first artist is the primary credit; participants carry one
  // unit each, and every extra actual name dilutes the ratio.
  const weights = desired.map((_group, index) => index === 0 ? 2 : 1)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let matchedWeight = 0
  desired.forEach((group, index) => {
    if (actual.some(key => group.has(key))) matchedWeight += weights[index]!
  })
  const extra = actual.filter(key => !desired.some(group => group.has(key)))
  const unknown = new Set(UNKNOWN_ARTISTS.map(name => matchingKey(name, config)))
  const missing = desired.length === 0 || actual.length === 0
  const mismatch = !missing && matchedWeight === 0
    && desired.some(group => [...group].some(key => !unknown.has(key)))
    && extra.some(key => !unknown.has(key))
  return {
    matchedWeight,
    totalWeight,
    extra,
    complete: desired.length > 0 && matchedWeight === totalWeight && extra.length === 0,
    strength: totalWeight > 0 ? matchedWeight / (totalWeight + extra.length) : 0,
    missing,
    mismatch,
  }
}

function addOnce(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value)
}
