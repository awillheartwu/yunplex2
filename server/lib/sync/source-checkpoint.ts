import { readConfigFromDb } from '../db'
import type { AppConfig } from '../config/types'
import { getSource } from '../playlist/store'
import type { PlaylistSource } from '../playlist/types'
import { sourceConvergenceSettingsKey } from './effective-settings'
import type { BindingVersionSnapshot } from './identity-coordinator'
import { getSongIdentityBindings } from './identity-store'
import { getLocalMediaAssets, type LocalMediaAsset } from './local-media-store'

export interface SourceConvergenceCheckpoint {
  bindings: BindingVersionSnapshot
  /** A rescan may renumber Plex media while its stable path keeps the binding version. */
  plexRatingKeys: ReadonlyMap<number, string | null>
  assets: ReadonlyMap<number, LocalMediaAsset>
}

/** Capture completion facts while the successful identity/Plex boundary is still held. */
export function captureSourceConvergenceCheckpoint(sourceSongIds: number[], identity?: Pick<SourceConvergenceCheckpoint, 'bindings' | 'plexRatingKeys'>): SourceConvergenceCheckpoint {
  if (!identity) {
    const bindings = getSongIdentityBindings(sourceSongIds)
    identity = {
      bindings: new Map(sourceSongIds.map(id => [id, bindings.get(id)?.updatedAt ?? null])),
      plexRatingKeys: new Map(sourceSongIds.map(id => [id, bindings.get(id)?.plexRatingKey ?? null])),
    }
  }
  return { ...identity, assets: getLocalMediaAssets(sourceSongIds) }
}

/** The caller commits synchronously after this check; no network wait may follow it. */
export function sourceConvergenceCheckpointIsCurrent(source: PlaylistSource, config: AppConfig, checkpoint: SourceConvergenceCheckpoint): boolean {
  const current = getSource(source.id)
  if (!current || current.plexPlaylistRatingKey !== source.plexPlaylistRatingKey
    || sourceConvergenceSettingsKey(current, readConfigFromDb()) !== sourceConvergenceSettingsKey(source, config)) return false
  const ids = [...checkpoint.bindings.keys()]
  const bindings = getSongIdentityBindings(ids)
  const assets = getLocalMediaAssets(ids)
  return ids.every(id => (bindings.get(id)?.updatedAt ?? null) === checkpoint.bindings.get(id)
    && (bindings.get(id)?.plexRatingKey ?? null) === checkpoint.plexRatingKeys.get(id)
    && JSON.stringify(assets.get(id) ?? null) === JSON.stringify(checkpoint.assets.get(id) ?? null))
}
