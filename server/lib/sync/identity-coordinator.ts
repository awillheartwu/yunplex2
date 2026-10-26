import { finalizeCorrectionBinding } from './media-corrections'
import { getDb } from '../db'
import {
  getActiveSongIdentityBindings,
  getSongIdentityBindings,
  upsertVerifiedSongIdentityBinding,
  type BindingInput,
  type SongIdentityBinding,
} from './identity-store'

export type BindingVersionSnapshot = Map<number, string | null>

let tail: Promise<void> = Promise.resolve()

/** Fair process-local mutex around the final Plex mutation boundary. */
export async function acquireIdentityMutationLock(): Promise<() => void> {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const previous = tail
  tail = previous.then(() => gate)
  await previous
  let released = false
  return () => {
    if (released) return
    released = true
    release()
  }
}

export function captureBindingVersions(songIds: number[], includeInactive = false): BindingVersionSnapshot {
  const bindings = includeInactive ? getSongIdentityBindings(songIds) : getActiveSongIdentityBindings(songIds)
  return new Map([...new Set(songIds)].map(songId => [songId, bindings.get(songId)?.updatedAt ?? null]))
}

export function assertBindingVersionsUnchanged(snapshot: BindingVersionSnapshot, includeInactive = false): void {
  const current = includeInactive ? getSongIdentityBindings([...snapshot.keys()]) : getActiveSongIdentityBindings([...snapshot.keys()])
  for (const [songId, version] of snapshot) {
    if ((current.get(songId)?.updatedAt ?? null) !== version) {
      throw new Error(`歌曲 #${songId} 的身份已变化，本轮已安全中止 Plex 写入和删除，请重试同步`)
    }
  }
}

/** Plex can renumber stable path identities without changing the user's choice version. */
export function assertBindingRatingKeysUnchanged(snapshot: ReadonlyMap<number, string | null>): void {
  const current = getSongIdentityBindings([...snapshot.keys()])
  for (const [songId, ratingKey] of snapshot) {
    if ((current.get(songId)?.plexRatingKey ?? null) !== ratingKey) {
      throw new Error(`歌曲 #${songId} 的 Plex 编号已变化，本轮已中止旧身份提交，请重试同步`)
    }
  }
}

/**
 * Commit identities discovered by this convergence only after proving that
 * no external identity mutation invalidated its earlier lookup decisions.
 * The caller must hold the identity mutation lock until Plex mutation ends.
 */
export function applyVerifiedBindingsIfSnapshotCurrent(
  snapshot: BindingVersionSnapshot,
  pendingBindings: readonly BindingInput[],
  ratingKeys: ReadonlyMap<number, string | null>,
): Map<number, SongIdentityBinding> {
  assertBindingVersionsUnchanged(snapshot)
  assertBindingRatingKeysUnchanged(ratingKeys)
  getDb().transaction(()=>{
    for (const binding of pendingBindings) {
      if (!finalizeCorrectionBinding(binding)) upsertVerifiedSongIdentityBinding(binding)
    }
  })()
  return getActiveSongIdentityBindings([...snapshot.keys()])
}
