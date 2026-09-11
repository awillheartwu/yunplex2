import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { normalizePlexPath, type SongIdentityBinding } from '../sync/identity-store'
import { albumsMatchConservatively, normalizeTitle, stripPunct, titlesMatchConservatively } from '../sync/matchers'
import { plexCandidate, type InitializationItemPlan } from './types'

const ARTIST_SEPARATOR = /\s*(?:&|\/|、|,|，|\+|;|；|\b(?:feat(?:uring)?|ft|with|and)\.?\b)\s*/giu

function canonical(value: string): string {
  return stripPunct(normalizeTitle(value)).normalize('NFC').toLocaleLowerCase()
}

function artistKey(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
}

function candidateArtists(track: PlexTrack): string[] {
  const values = [track.originalTitle || track.grandparentTitle || '']
  for (const match of track.title.matchAll(/(?:\(|\[)\s*(?:feat(?:uring)?|ft|with)\.?\s+([^)\]]+)\s*(?:\)|\])/giu)) {
    values.push(match[1] || '')
  }
  return [...new Set(values.flatMap(value => value.split(ARTIST_SEPARATOR)).map(artistKey).filter(Boolean))]
}

function completeArtistSet(song: NeteaseSong, track: PlexTrack, aliases: Record<string, string>): boolean {
  const desired = song.artists.map(artist => artistKey(aliases[artist.name] || artist.name)).filter(Boolean).sort()
  const candidate = candidateArtists(track).sort()
  return desired.length > 0 && desired.length === candidate.length && desired.every((value, index) => value === candidate[index])
}

function primaryArtistMatches(song: NeteaseSong, track: PlexTrack, aliases: Record<string, string>): boolean {
  const plex = artistKey(track.grandparentTitle || '')
  return Boolean(plex && song.artists.some(artist => {
    const desired = artistKey(aliases[artist.name] || artist.name)
    return desired === plex || (desired.length > 2 && (desired.includes(plex) || plex.includes(desired)))
  }))
}

function durationDelta(song: NeteaseSong, track: PlexTrack): number | null {
  const duration = Number(track.duration)
  return song.dt > 0 && Number.isFinite(duration) && duration > 0 ? Math.abs(song.dt - duration) : null
}

function strongId(track: PlexTrack, songId: number): boolean {
  return (track.Media ?? []).some(media => (media.Part ?? []).some(part => {
    const match = part.file?.match(/\[netease-(\d+)\]/i)
    return Boolean(match && Number(match[1]) === songId)
  }))
}

function findCurrentBindingTrack(binding: SongIdentityBinding, tracks: PlexTrack[]): PlexTrack | null {
  const expectedPath = normalizePlexPath(binding.plexFilePath)
  if (!expectedPath) return null
  const candidates = binding.plexRatingKey
    ? tracks.filter(track => String(track.ratingKey) === binding.plexRatingKey)
    : tracks
  return candidates.find(track => (track.Media ?? []).some(media => (media.Part ?? [])
    .some(part => normalizePlexPath(part.file || '') === expectedPath))) ?? null
}

export function buildInitializationPlans(input: {
  songs: NeteaseSong[]
  tracks: PlexTrack[]
  bindings: Map<number, SongIdentityBinding>
  aliases?: Record<string, string>
}): InitializationItemPlan[] {
  const aliases = input.aliases ?? {}
  const byTitle = new Map<string, PlexTrack[]>()
  const bySongId = new Map<number, PlexTrack[]>()
  for (const track of input.tracks) {
    const title = canonical(track.title || '')
    if (title) byTitle.set(title, [...(byTitle.get(title) ?? []), track])
    for (const media of track.Media ?? []) for (const part of media.Part ?? []) {
      const match = part.file?.match(/\[netease-(\d+)\]/i)
      if (!match) continue
      const songId = Number(match[1])
      bySongId.set(songId, [...(bySongId.get(songId) ?? []), track])
    }
  }

  const positions = new Map<number, { first: number; count: number }>()
  input.songs.forEach((song, index) => {
    const current = positions.get(song.id)
    positions.set(song.id, current ? { first: current.first, count: current.count + 1 } : { first: index, count: 1 })
  })

  return [...positions.entries()].map(([songId, occurrence]) => {
    const song = input.songs[occurrence.first]!
    const binding = input.bindings.get(songId)
    const base = {
      neteaseSongId: song.id,
      position: occurrence.first,
      occurrenceCount: occurrence.count,
      title: song.name,
      artists: song.artists.map(artist => artist.name),
      album: song.album.name,
      trackNumber: song.no || null,
      durationMs: song.dt || null,
      expectedBindingUpdatedAt: binding?.updatedAt ?? null,
    }
    const currentBindingTrack = binding?.status === 'active'
      ? findCurrentBindingTrack(binding, input.tracks)
      : null
    if (binding && currentBindingTrack) {
      const candidate = plexCandidate(currentBindingTrack)
      return {
        ...base,
        tier: 'preserved',
        candidate,
        candidates: [candidate],
        evidence: { rule: 'active_binding_verified', bindingMethod: binding.bindingMethod },
        decision: 'defer',
      }
    }

    const idTracks = [...new Map((bySongId.get(song.id) ?? []).map(track => [track.ratingKey, track])).values()]
    const safeIdTracks = idTracks.filter(track => strongId(track, song.id)
      && titlesMatchConservatively(song.name, track.title)
      && (durationDelta(song, track) === null || durationDelta(song, track)! <= 3000))
    if (safeIdTracks.length === 1) {
      const candidate = plexCandidate(safeIdTracks[0]!)
      return { ...base, tier: 'strong_id', candidate, candidates: [candidate], evidence: { rule: 'unique_netease_path_id' }, decision: 'adopt' }
    }
    if (safeIdTracks.length > 1) {
      return { ...base, tier: 'conflict', candidate: null, candidates: safeIdTracks.map(plexCandidate), evidence: { rule: 'duplicate_netease_path_id' }, decision: 'defer' }
    }

    const titleTracks = [...new Map((byTitle.get(canonical(song.name)) ?? []).map(track => [track.ratingKey, track])).values()]
      .filter(track => titlesMatchConservatively(song.name, track.title))
    const high = titleTracks.filter(track => completeArtistSet(song, track, aliases)
      && albumsMatchConservatively(song.album.name, track.parentTitle || '')
      && song.no > 0 && Number(track.index) === song.no
      && durationDelta(song, track) !== null && durationDelta(song, track)! <= 2000)
    if (high.length === 1) {
      const candidate = plexCandidate(high[0]!)
      return { ...base, tier: 'high_confidence', candidate, candidates: [candidate], evidence: { rule: 'strict_local_metadata', durationDeltaMs: durationDelta(song, high[0]!) }, decision: 'defer' }
    }
    const possible = titleTracks.filter(track => primaryArtistMatches(song, track, aliases)
      && durationDelta(song, track) !== null && durationDelta(song, track)! <= 3000)
    if (possible.length === 1) {
      const candidate = plexCandidate(possible[0]!)
      return { ...base, tier: 'possible', candidate, candidates: [candidate], evidence: { rule: 'title_artist_duration', durationDeltaMs: durationDelta(song, possible[0]!) }, decision: 'defer' }
    }
    const candidates = possible.length > 1 ? possible : titleTracks
    if (candidates.length) {
      const rule = candidates.length === 1 ? 'title_only_candidate' : 'multiple_local_candidates'
      return { ...base, tier: 'ambiguous', candidate: null, candidates: candidates.slice(0, 20).map(plexCandidate), evidence: { rule }, decision: 'defer' }
    }
    return { ...base, tier: 'unmatched', candidate: null, candidates: [], evidence: { rule: 'no_local_candidate' }, decision: 'defer' }
  })
}
