import { readConfigFromDb } from '../../lib/db'
import { getSource } from '../../lib/playlist/store'
import {
  getPlaylistTracks,
  getTracksByRatingKeys,
  initPlexClient,
  type PlexTrack,
} from '../../lib/plex-client'
import { fail, success } from '../../lib/response'
import {
  getSongIdentityBindings,
  markSongIdentityBindingStale,
  normalizePlexPath,
  upsertVerifiedSongIdentityBinding,
} from '../../lib/sync/identity-store'
import {
  listPlaylistSourceTrackOccurrences,
  recordPlaylistAlignmentValidation,
} from '../../lib/sync/match-management-store'

function paths(track: PlexTrack): string[] {
  return track.Media?.flatMap(media =>
    media.Part?.flatMap(part => part.file ? [normalizePlexPath(part.file)] : []) ?? [],
  ) ?? []
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ sourceId?: string; songIds?: number[] }>(event)
  const requestedIds = Array.isArray(body.songIds)
    ? body.songIds.filter(id => Number.isSafeInteger(id) && id > 0)
    : []
  const source = body.sourceId ? getSource(body.sourceId) : null
  if (body.sourceId && !source) return fail('歌单源不存在')
  const songIds = [...new Set(requestedIds.length
    ? requestedIds
    : source
      ? listPlaylistSourceTrackOccurrences(source.id).map(item => item.neteaseSongId)
      : [])]
  if (!songIds.length) return fail('请选择要验证的歌曲或歌单')

  try {
    const cfg = readConfigFromDb()
    await initPlexClient(cfg.plex)
    const bindings = getSongIdentityBindings(songIds)
    const active = [...bindings.values()].filter(binding => binding.status === 'active')
    const byRating = await getTracksByRatingKeys(active.flatMap(binding => binding.plexRatingKey ? [binding.plexRatingKey] : []))
    const playlistTracks = source?.plexPlaylistRatingKey
      ? await getPlaylistTracks(source.plexPlaylistRatingKey, 99999)
      : []
    const byPath = new Map<string, PlexTrack>()
    for (const track of [...byRating.values(), ...playlistTracks]) {
      for (const path of paths(track)) byPath.set(path, track)
    }

    let valid = 0
    let recovered = 0
    let stale = 0
    let unbound = 0
    for (const songId of songIds) {
      const binding = bindings.get(songId)
      if (!binding || binding.status !== 'active') {
        unbound++
        continue
      }
      const direct = binding.plexRatingKey ? byRating.get(binding.plexRatingKey) : undefined
      const directHasPath = direct && paths(direct).includes(normalizePlexPath(binding.plexFilePath))
      const track = directHasPath ? direct : byPath.get(normalizePlexPath(binding.plexFilePath))
      if (!track) {
        markSongIdentityBindingStale(songId, { reason: 'plex_validation_missing', validatedAt: new Date().toISOString() })
        stale++
        continue
      }
      const ratingRecovered = track.ratingKey !== binding.plexRatingKey
      upsertVerifiedSongIdentityBinding({
        neteaseSongId: songId,
        plexSectionKey: binding.plexSectionKey,
        plexFilePath: binding.plexFilePath,
        plexRelativePath: binding.plexRelativePath,
        plexRatingKey: track.ratingKey,
        mbRecordingId: binding.mbRecordingId,
        bindingMethod: binding.bindingMethod,
        status: 'active',
        evidence: { ...binding.evidence, validation: ratingRecovered ? 'path_recovered' : 'rating_key_verified' },
      })
      if (ratingRecovered) recovered++
      else valid++
    }
    const alignment = source
      ? recordPlaylistAlignmentValidation({
          sourceId: source.id,
          neteaseSongIds: requestedIds.length ? songIds : undefined,
          playlistItems: playlistTracks.map(track => ({
            ratingKey: track.ratingKey,
            plexFilePaths: paths(track),
          })),
        })
      : null
    return success({
      requested: songIds.length,
      valid,
      recovered,
      stale,
      unbound,
      aligned: alignment?.aligned ?? 0,
      pendingAlignment: alignment?.pending ?? 0,
      missingAlignment: alignment?.missing ?? 0,
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Plex 批量验证失败')
  }
})
