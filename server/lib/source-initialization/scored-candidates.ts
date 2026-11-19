import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import type { InitializationMatchingConfig } from '../../../shared/initialization-matching'
import { candidateFacts, type CandidateFacts } from './candidate-facts'
import { scoreCandidate } from './candidate-score'
import { compareCandidateQuality } from './candidate-quality'
import { plexCandidate } from './types'
import { compareRecording } from './recording-evidence'

export type ScoredCandidate = ReturnType<typeof scoredCandidates>[number]

export function scoredCandidates(song:NeteaseSong,tracks:PlexTrack[],config:InitializationMatchingConfig,facts?:Map<string,CandidateFacts>) {
  const values = [...new Map(tracks.map(track => [String(track.ratingKey), track])).values()].map(track => {
    const evidence = facts?.get(String(track.ratingKey)) ?? candidateFacts(song, track, config)
    const score = scoreCandidate(song, track, config, evidence)
    return { track, score, recordingMatch: compareRecording(song, track, config, evidence, score).recommend }
  })
  const directory=(track:PlexTrack)=>Boolean(config.preferredDirectory&&track.Media?.some(media=>media.Part?.some(part=>part.file?.startsWith(config.preferredDirectory.replace(/\/+$/,'')+'/'))))
  values.sort((a,b)=>Number(b.score.eligible)-Number(a.score.eligible)||b.score.total-a.score.total||Number(b.score.completeArtists)-Number(a.score.completeArtists)||b.score.titleStrength-a.score.titleStrength
    ||(a.score.durationDeltaMs??Infinity)-(b.score.durationDeltaMs??Infinity)||b.score.parts.album-a.score.parts.album||b.score.parts.track-a.score.parts.track
    ||Number(directory(b.track))-Number(directory(a.track))||(config.preferLossless?compareCandidateQuality(a.track,b.track):0)||String(a.track.ratingKey).localeCompare(String(b.track.ratingKey),'en',{numeric:true}))
  const top=values[0],next=values[1]
  if(top&&next&&top.score.eligible&&next.score.eligible)top.score.risks.push(top.score.total===next.score.total?'最高分并列，按稳定顺序选择':`领先次优 ${(top.score.total-next.score.total).toFixed(1)} 分`)
  return values.map(({ track, score, recordingMatch }) => ({ candidate: plexCandidate(track), score, recordingMatch }))
}
