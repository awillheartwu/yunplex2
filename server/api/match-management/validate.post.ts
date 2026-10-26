import { getDb, readConfigFromDb } from '../../lib/db'
import { acquireIdentityMutationLock, assertBindingRatingKeysUnchanged, assertBindingVersionsUnchanged, captureBindingVersions } from '../../lib/sync/identity-coordinator'
import { getSource } from '../../lib/playlist/store'
import {
  getPlaylistTracks,
  getTracksByRatingKeys,
  findTracksByFilePath,
  initPlexClient,
  type PlexTrack,
} from '../../lib/plex-client'
import { isPlexMediaPathAvailable, isPlexTrackAvailable } from '../../lib/plex-media'
import { conflictingLookupOwner } from '../../lib/sync/lookup-identity'
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
  markSongSourcesPendingAlignment,
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
    const versions = captureBindingVersions(songIds, true)
    const ratingKeys = new Map(songIds.map(id => [id, bindings.get(id)?.plexRatingKey ?? null]))
    const active = [...bindings.values()].filter(binding => binding.status === 'active')
    const byRating = await getTracksByRatingKeys(active.flatMap(binding => binding.plexRatingKey ? [binding.plexRatingKey] : []))
    const playlistTracks = (source?.plexPlaylistRatingKey
      ? await getPlaylistTracks(source.plexPlaylistRatingKey, 99999) : []).filter(isPlexTrackAvailable)
    const verification = new Map<number, { track: PlexTrack | null; reason: string }>()
    for (const binding of active) {
      const path = normalizePlexPath(binding.plexFilePath)
      if (!isPlexMediaPathAvailable(path, cfg)) {
        verification.set(binding.neteaseSongId, { track: null, reason: 'plex_validation_missing' })
        continue
      }
      const direct = binding.plexRatingKey ? byRating.get(binding.plexRatingKey) : undefined
      if (direct && paths(direct).includes(path)) {
        verification.set(binding.neteaseSongId, { track: direct, reason: '' })
        continue
      }
      const matches = binding.plexSectionKey
        ? (await findTracksByFilePath(binding.plexSectionKey, path)).filter(track => paths(track).includes(path)) : []
      verification.set(binding.neteaseSongId, {
        track: matches.length === 1 ? matches[0]! : null,
        reason: matches.length > 1 ? 'plex_validation_ambiguous' : 'plex_validation_missing',
      })
    }

    const release = await acquireIdentityMutationLock()
    try {
      assertBindingVersionsUnchanged(versions, true)
      assertBindingRatingKeysUnchanged(ratingKeys)
      if (source && getSource(source.id)?.updatedAt !== source.updatedAt) throw new Error('歌单源已被其他操作更新，请重新验证')
      return getDb().transaction(() => {
        // Check the entire batch before publishing recovered identities, so an
        // explicitly shared manual group can recover together after renumbering.
        const claimed = new Map<string, number>()
        for (const [songId, result] of verification) {
          if (!result.track) continue
          if (conflictingLookupOwner(songId, result.track.ratingKey, claimed, bindings) !== undefined) {
            verification.set(songId, { track: null, reason: 'plex_validation_conflict' })
          } else claimed.set(result.track.ratingKey, songId)
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
          const result = verification.get(songId)!
          const track = result.track
          if (!track) {
            markSongIdentityBindingStale(songId, { reason: result.reason, validatedAt: new Date().toISOString() })
            markSongSourcesPendingAlignment(songId)
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
      })()
    } finally { release() }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Plex 批量验证失败')
  }
})
