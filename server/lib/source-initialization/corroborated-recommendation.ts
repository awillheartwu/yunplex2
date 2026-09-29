import type { InitializationMatchingConfig } from '../../../shared/initialization-matching'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { aliasKeys, matchingKey, titleParts } from './matching-normalization'

/** Evidence for a reviewable recommendation, never for an automatic identity. */
export function corroboratedArtistEvidence(input: {
  song: NeteaseSong
  track: PlexTrack
  paths: string[]
  config: InitializationMatchingConfig
  missingOneContributor: boolean
}): string | null {
  const { song, track, paths, config } = input
  if (!config.corroboratedRecommendations || !config.usePathHints || paths.length !== 1) return null
  const path = paths[0]!
  const target = titleParts(song.name, config)
  // Filename independently retains the requested title; do not accept a fuzzy,
  // abbreviated, translated, or truncated filename as corroboration.
  const filename = path.split('/').pop()!.replace(/\.[^.]+$/, '')
    .replace(/^\s*(?:\d{1,2}[-.]\d{1,3}|\d{1,3})[.．\s_-]+/u, '')
  const filenameVariants = [filename]
  for (const name of song.artists.map(artist => artist.name)) {
    if (filename.toLowerCase().startsWith(name.toLowerCase() + ' - ')) filenameVariants.push(filename.slice(name.length + 3))
  }
  const faithfulFilename = filenameVariants.some(name => {
    const candidate = titleParts(name, config)
    return candidate.core === target.core && candidate.core !== ''
      && JSON.stringify(candidate.versions) === JSON.stringify(target.versions)
  })
  if (!faithfulFilename) return null
  if (input.missingOneContributor) return '交叉证据推荐：曲目艺人仅缺一位参与者，专辑主艺人、标题、曲序、时长与文件名相互印证'

  const names = song.artists.map(artist => artist.name).filter(Boolean)
  if (names.length !== 1 || target.contributors.length) return null
  const name = names[0]!
  const displayedArtist = config.useTrackArtist && track.originalTitle ? track.originalTitle : track.grandparentTitle || ''
  // A different Latin name or a conflicting CJK name is not a transliteration
  // discrepancy. E.g. Max Riser/Max Richter and 黑豹/黑屋 must remain reviewable.
  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(name)
    || !/[\p{Script=Latin}]/u.test(displayedArtist)
    || !/^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(displayedArtist)) return null
  const nameKeys = aliasKeys(name, config.useArtistAliases ? config.artistAliases : [], config)
  // Exclude the album directory itself: an eponymous album is not a second
  // independent artist signal.
  const directoryArtist = path.split('/').slice(0, -2).some(part => nameKeys.has(matchingKey(part, config)))
  if (!directoryArtist) return null
  return '交叉证据推荐：Plex 艺人为拉丁字母写法，原艺人目录、标题、专辑、曲序、时长与文件名相互印证；未自动学习别名'
}
