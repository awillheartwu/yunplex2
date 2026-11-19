import type { InitializationMatchingConfig } from '../../../shared/initialization-matching'
import { artistMatchingKey } from '../../../shared/initialization-matching-text'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { artistCreditKeys } from './artist-credits'
import { aliasKeys, matchingKey, titleParts, versionEvidence, type TitleParts } from './matching-normalization'

const UNKNOWN_ARTISTS=['Various Artists','Various','VA','群星','合辑','未知艺人','佚名','Unknown Artist','Unknown']

interface CandidateContext {
  songTitle: TitleParts
  trackTitle: TitleParts
  songTitleKeys: ReadonlySet<string>
  paths: string[]
  ownedByAnotherSong: boolean
}

/** Shared facts for the recommendation and score policies. */
export function candidateFacts(song:NeteaseSong,track:PlexTrack,config:InitializationMatchingConfig,context?:CandidateContext) {
  const songTitle=context?.songTitle??titleParts(song.name,config),trackTitle=context?.trackTitle??titleParts(track.title||'',config)
  const paths=context?.paths??track.Media?.flatMap(media=>media.Part?.flatMap(part=>part.file?[part.file]:[])??[])??[]
  const titleKeys=context?.songTitleKeys??new Set([...songTitle.variants,...aliasKeys(song.name,config.titleAliases,config)])
  const exactTitle=titleKeys.has(trackTitle.core)||[...aliasKeys(track.title||'',config.titleAliases,config)].some(key=>titleKeys.has(key))
  const songAlbumKey=matchingKey(song.album.name||'',config),trackAlbumKey=matchingKey(track.parentTitle||'',config)
  const trackIndex=Number(track.index),numberKnown=song.no>0&&Number.isInteger(trackIndex)&&trackIndex>0
  const delta=song.dt>0&&Number(track.duration)>0?Math.abs(song.dt-Number(track.duration)):null
  const foreignNeteaseId=paths.some(path=>[...path.matchAll(/\[netease-(\d+)\]/gi)].some(match=>Number(match[1])!==song.id))
  return {songTitle,trackTitle,paths,exactTitle,foreignNeteaseId,ownedByAnotherSong:context?.ownedByAnotherSong??false,
    version:versionEvidence(songTitle,trackTitle,config),delta,
    recommendedDuration:delta!==null&&delta<=config.recommendDurationMs&&delta/song.dt*100<=config.recommendDurationPercent,
    songAlbumKey,trackAlbumKey,albumExact:Boolean(songAlbumKey)&&songAlbumKey===trackAlbumKey,
    numberKnown,numberEqual:numberKnown&&trackIndex===song.no,artist:artistEvidence(song,track,songTitle,trackTitle,config)}
}
export type CandidateFacts=ReturnType<typeof candidateFacts>

export interface ArtistEvidence {
  matchedWeight: number
  totalWeight: number
  extra: string[]
  complete: boolean
  strength: number
  missing: boolean
  mismatch: boolean
  primary: boolean
  pathArtist: boolean
  missingOneContributor: boolean
  missingCollaborators: boolean
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
  const covered=desired.map(group=>actual.some(key=>group.has(key)))
  const primary=covered[0]===true
  const primaryAlbumArtist=desired[0]?.has(artistMatchingKey(track.grandparentTitle||'',config))??false
  const pathArtist=config.usePathHints&&(track.Media??[]).some(media=>(media.Part??[]).some(part=>part.file?.split('/').slice(0,-1).some(value=>desired.some(group=>group.has(artistMatchingKey(value,config))))))
  return {
    primary,pathArtist,
    missingOneContributor:desired.length>=2&&desired.length<=3&&primary&&primaryAlbumArtist&&actual.length===desired.length-1&&actual.every(key=>desired.some(group=>group.has(key))),
    missingCollaborators:primary&&covered.some(value=>!value)&&actual.length>0&&actual.every(key=>desired.some(group=>group.has(key))),
    matchedWeight,
    totalWeight,
    extra,
    complete: desired.length > 0 && matchedWeight === totalWeight && extra.length === 0,
    strength: totalWeight > 0 ? matchedWeight / (totalWeight + extra.length) : 0,
    missing,
    mismatch,
  }
}
