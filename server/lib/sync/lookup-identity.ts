import { getDb } from '../db'
import { acquireIdentityMutationLock, assertBindingRatingKeysUnchanged, assertBindingVersionsUnchanged, type BindingVersionSnapshot } from './identity-coordinator'
import { BindingIdentityConflictError, getSongIdentityBindingsByRatingKey, upsertVerifiedSongIdentityBinding, type SongIdentityBinding } from './identity-store'
import { normalizePlexPath } from './identity-normalization'
import { getLocalMediaAssets, type LocalMediaAsset } from './local-media-store'

/** Only a previously confirmed manual relationship permits shared Plex media. */
export function conflictingLookupOwner(songId: number, ratingKey: string,
  claimed: ReadonlyMap<string, number>, bindings: ReadonlyMap<number, SongIdentityBinding>): number | undefined {
  const owners = new Map<number, SongIdentityBinding | undefined>(getSongIdentityBindingsByRatingKey(ratingKey).map(binding => [binding.neteaseSongId, binding]))
  const claimedOwner = claimed.get(ratingKey)
  if (claimedOwner !== undefined && claimedOwner !== songId && !owners.has(claimedOwner)) {
    owners.set(claimedOwner, bindings.get(claimedOwner))
  }
  const current = bindings.get(songId)
  for (const [ownerSongId, owner] of owners) {
    if (ownerSongId === songId) continue
    const confirmed = current?.status === 'active' && owner?.status === 'active'
      && current.bindingMethod === 'manual' && owner.bindingMethod === 'manual'
      && current.plexRatingKey === owner.plexRatingKey && current.plexSectionKey === owner.plexSectionKey
      && normalizePlexPath(current.plexFilePath) === normalizePlexPath(owner.plexFilePath)
    if (!confirmed) return ownerSongId
  }
}

/** Network lookup never publishes a rejected candidate or overwrites a newer choice. */
export async function commitLookupMutations(input: {
  versions: BindingVersionSnapshot
  ratingKeys: ReadonlyMap<number, string | null>
  mutations: ReadonlyMap<number, readonly (() => void)[]>
  bindings: ReadonlyMap<number, SongIdentityBinding>
  assets: ReadonlyMap<number, LocalMediaAsset>
  resolutions: readonly { song: { id: number }; plexRatingKey?: string }[]
}): Promise<void> {
  const release = await acquireIdentityMutationLock()
  try {
    assertBindingVersionsUnchanged(input.versions, true)
    assertBindingRatingKeysUnchanged(input.ratingKeys)
    getDb().transaction(() => {
      const assets = getLocalMediaAssets([...input.mutations.keys()])
      for (const songId of input.mutations.keys()) {
        if (JSON.stringify(assets.get(songId) ?? null) !== JSON.stringify(input.assets.get(songId) ?? null)) {
          throw new Error(`歌曲 #${songId} 的本地文件记录已变化，本轮已中止旧观测提交，请重试同步`)
        }
      }
      for (const resolution of input.resolutions) {
        if (!input.mutations.has(resolution.song.id) || !resolution.plexRatingKey) continue
        if (conflictingLookupOwner(resolution.song.id, resolution.plexRatingKey, new Map(), input.bindings) !== undefined) {
          throw new BindingIdentityConflictError()
        }
      }
      for (const mutations of input.mutations.values()) for (const commit of mutations) commit()
    })()
  } finally { release() }
}

export function bindResolvedIdentity(
  songId: number,
  sectionKey: string,
  sectionRoot: string,
  ratingKey: string,
  plexPath: string,
  evidence: Record<string, unknown>,
): void {
  upsertVerifiedSongIdentityBinding({
    neteaseSongId: songId,
    plexSectionKey: sectionKey,
    plexSectionRoot: sectionRoot,
    plexFilePath: plexPath,
    plexRatingKey: ratingKey,
    bindingMethod: 'path',
    status: 'active',
    evidence,
  })
}
