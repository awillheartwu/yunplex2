import { getPlaylistWriteTracks, insertTracksIntoPlaylist, movePlaylistItemAfter, movePlaylistItemToTop, removeTrackFromPlaylist, type PlexTrack } from '../plex-client'
import { getExternalRequestSignal, withExternalRequestSignal } from '../external-request-context'
import { classifyErrorCode } from '../domain-error'
import type { DomainErrorCode } from '../../../shared/domain-errors'
import type { ReorderMutation } from './reorder'
import { clearPendingPlaylistWrite, pendingPlaylistWrite, playlistWriteError, savePendingPlaylistWrite, writeRequestDefinitelyEnded, type PendingPlaylistWrite, type PlaylistWriteItem } from './playlist-write-state'
import { inspectInsertedItems, playlistItemsHash, playlistWriteItems, samePlaylistItems } from './playlist-write-snapshot'

export interface PlaylistMutationOwner {
  sourceId: string
  scope: string
  assertCurrent: () => void
  validateTracks?: (tracks: readonly PlexTrack[]) => void
  validateInsert?: (keys: readonly string[]) => Promise<void>
}
export type PlaylistMutationRequest =
  | { action: 'insert'; ratingKeys: string[] }
  | { action: 'move'; playlistItemId: number; afterPlaylistItemId: number | null }
  | { action: 'remove'; playlistItemId: number }

export class PlaylistMutationError extends Error {
  constructor(message: string, readonly code: DomainErrorCode, readonly mutations: ReorderMutation[], readonly items?: PlaylistWriteItem[], cause?: unknown) {
    super(message, cause ? { cause } : undefined)
  }
}

export async function readPlaylistWriteSnapshot(key: string, owner: PlaylistMutationOwner) {
  const tracks = await getPlaylistWriteTracks(key)
  owner.assertCurrent()
  owner.validateTracks?.(tracks)
  return playlistWriteItems(tracks)
}

/** A new run must prove the previous boundary before issuing any new write. */
export function recoverPlaylistMutation(owner: PlaylistMutationOwner, key: string, actual: PlaylistWriteItem[]): void {
  const state = pendingPlaylistWrite(owner.sourceId)
  if (!state) return
  if (state.scope !== owner.scope || state.playlistKey !== key) throw playlistWriteError('上次 Plex 写入目标或连接不同，请核对并在收藏设置中明确指定实际目标')
  const additive = state.kind === 'insert' || state.kind === 'create'
  const inserted = additive
    ? inspectInsertedItems(state.before, actual, state.ratingKeys) : null
  const complete = additive ? Boolean(inserted && inserted.missing.length === 0) : samePlaylistItems(state.expected, actual)
  const knownPrefix = state.kind !== 'create' && state.kind !== 'insert' && state.acknowledged
    && state.prefixHashes?.slice(0, state.submitted + 1).includes(playlistItemsHash(actual))
  if (!complete && !knownPrefix) throw playlistWriteError('上次 Plex 写入结果仍无法完整确认，已停止继续写入；核对歌单后可在收藏设置中重新明确指定目标')
  clearPendingPlaylistWrite(owner.sourceId)
}

/** Serial bounded batch, with one durable boundary and concrete readback evidence. */
export async function executePlaylistMutation(
  key: string, before: PlaylistWriteItem[], requests: PlaylistMutationRequest[], owner: PlaylistMutationOwner,
  submitted: (count: number) => void,
): Promise<{ items: PlaylistWriteItem[]; mutations: ReorderMutation[]; complete: boolean }> {
  owner.assertCurrent()
  if (pendingPlaylistWrite(owner.sourceId)) throw playlistWriteError('仍有未确认的 Plex 写入，本轮未发送新请求')
  const kind = requests[0]?.action
  if (!kind || requests.some(request => request.action !== kind)) throw new Error('Plex 写入批次类型无效')
  const expected = [...before]
  const prefixHashes = [playlistItemsHash(before)]
  for (const request of requests) {
    if (request.action === 'insert') continue
    const index = expected.findIndex(item => item.playlistItemId === request.playlistItemId)
    if (index < 0) throw playlistWriteError('Plex 写入计划缺少具体条目', 'concurrent_operation')
    const [item] = expected.splice(index, 1)
    if (request.action === 'move') {
      const anchor = request.afterPlaylistItemId === null ? -1 : expected.findIndex(item => item.playlistItemId === request.afterPlaylistItemId)
      if (request.afterPlaylistItemId !== null && anchor < 0) throw playlistWriteError('Plex 移动锚点已变化', 'concurrent_operation')
      expected.splice(anchor + 1, 0, item!)
    }
    prefixHashes.push(playlistItemsHash(expected))
  }
  const ratingKeys = requests.flatMap(request => request.action === 'insert' ? request.ratingKeys : [])
  const state: PendingPlaylistWrite = { kind, playlistKey: key, scope: owner.scope, before, expected, ratingKeys,
    submitted: 0, acknowledged: false, prefixHashes, startedAt: new Date().toISOString() }
  let writeError: unknown
  for (const request of requests) {
    try {
      owner.assertCurrent()
      state.submitted++
      state.acknowledged = false
      savePendingPlaylistWrite(owner.sourceId, state)
      submitted(request.action === 'insert' ? request.ratingKeys.length : 1)
      if (request.action === 'insert') await insertTracksIntoPlaylist(key, request.ratingKeys)
      else if (request.action === 'remove') await removeTrackFromPlaylist(key, request.playlistItemId)
      else if (request.afterPlaylistItemId === null) await movePlaylistItemToTop(key, request.playlistItemId)
      else await movePlaylistItemAfter(key, request.playlistItemId, request.afterPlaylistItemId)
      state.acknowledged = true
      savePendingPlaylistWrite(owner.sourceId, state)
      owner.assertCurrent()
    } catch (error) { writeError = error; break }
  }
  if (state.submitted === 0) throw writeError

  // Cancellation ends writes, but a short independent read can still record what actually happened.
  let actual: PlaylistWriteItem[] | undefined
  let readError: unknown
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tracks = getExternalRequestSignal()?.aborted
        ? await withExternalRequestSignal(AbortSignal.timeout(5000), () => getPlaylistWriteTracks(key))
        : await getPlaylistWriteTracks(key)
      actual = playlistWriteItems(tracks)
      owner.validateTracks?.(tracks)
      if (kind === 'insert' ? inspectInsertedItems(before, actual, ratingKeys)?.missing.length === 0 : samePlaylistItems(expected, actual)) break
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250))
    }
  } catch (error) { readError = error }

  const inserted = actual && kind === 'insert' ? inspectInsertedItems(before, actual, ratingKeys) : null
  const complete = Boolean(actual && !readError && (kind === 'insert' ? inserted && inserted.missing.length === 0 : samePlaylistItems(expected, actual)))
  const prefix = actual && !readError ? prefixHashes.slice(0, state.submitted + 1).lastIndexOf(playlistItemsHash(actual)) : -1
  const known = complete || Boolean(!readError && (state.acknowledged || writeRequestDefinitelyEnded(writeError))
    && (kind === 'insert' ? inserted : prefix >= 0))
  const mutations: ReorderMutation[] = []
  if (inserted && !readError) inserted.inserted.forEach(item => mutations.push({ action: 'insert', ratingKey: item.ratingKey, playlistItemId: item.playlistItemId }))
  if (kind !== 'insert' && prefix >= 0) {
    for (const request of requests.slice(0, prefix)) {
      if (request.action === 'move') mutations.push(request)
      if (request.action === 'remove') {
        const item = before.find(item => item.playlistItemId === request.playlistItemId)!
        mutations.push({ action: 'remove', ...item })
      }
    }
  }
  if (known) clearPendingPlaylistWrite(owner.sourceId)
  let contextError: unknown
  try { owner.assertCurrent() } catch (error) { contextError = error }
  const root = contextError ?? writeError ?? readError
  const rootCode = contextError ? classifyErrorCode(contextError, 'concurrent_operation')
    : root ? classifyErrorCode(root, 'failed_plex_insert') : 'failed_plex_insert'
  const mustStop = Boolean(contextError) || rootCode === 'plex_authentication_failed' || rootCode === 'concurrent_operation' || getExternalRequestSignal()?.aborted
  if ((root && (!complete || mustStop)) || !known || (kind === 'insert' && !complete)) {
    const uncertain = !known || (!complete && kind === 'insert' && !writeRequestDefinitelyEnded(writeError))
    const code = ['plex_authentication_failed', 'concurrent_operation', 'media_identity_conflict'].includes(rootCode)
      ? rootCode : uncertain ? 'plex_write_uncertain' : rootCode
    // A partial HTTP 200 is still uncertain: the server may finish it after our observation.
    if (!complete && kind === 'insert' && !writeRequestDefinitelyEnded(writeError)) savePendingPlaylistWrite(owner.sourceId, state)
    throw new PlaylistMutationError(!known ? 'Plex 写入结果待确认，已停止后续写入和删除'
      : root instanceof Error ? root.message : 'Plex 本批次未完整加入目标歌曲', code, mutations, actual, root)
  }
  return { items: actual!, mutations, complete }
}
