import { normalize } from 'node:path'
import { getDb } from '../db'
import {
  getLocalMediaAsset,
  upsertLocalMediaAsset,
  type LocalMediaAsset,
  type LocalMediaProvenance,
} from '../sync/local-media-store'

export interface CompletedMediaWrite {
  neteaseSongId: number
  filePath: string
  provenance: LocalMediaProvenance
  taskId?: string | null
  audioDownloaded: boolean
  audioOperation?: 'downloaded' | 'redownloaded' | 'reused'
  sourceId?: string | null
  runId?: string | null
}

/**
 * Commit one completed audio operation as the durable Local Media Asset fact.
 * File execution stays side-effect free; every queue/direct caller crosses this
 * single seam exactly once after tags have succeeded.
 */
export function commitCompletedMediaWrite(input: CompletedMediaWrite): LocalMediaAsset {
  const previous = getLocalMediaAsset(input.neteaseSongId)
  const normalizedPath = normalize(input.filePath)
  const reusesManagedAsset = !input.audioDownloaded
    && previous?.ownership === 'managed'
    && normalize(previous.filePath) === normalizedPath
  const ownership = input.audioDownloaded || reusesManagedAsset
    ? 'managed' as const
    : 'external' as const
  const audioOperation = input.audioDownloaded
    ? input.audioOperation === 'redownloaded' ? 'redownloaded' : 'downloaded'
    : reusesManagedAsset
      ? 'reused_managed'
      : 'adopted_existing'

  const asset = upsertLocalMediaAsset({
    neteaseSongId: input.neteaseSongId,
    filePath: normalizedPath,
    provenance: reusesManagedAsset ? previous!.provenance : input.provenance,
    ownership,
    sourceTaskId: reusesManagedAsset ? previous!.sourceTaskId : input.taskId ?? null,
    evidence: {
      ...(reusesManagedAsset ? previous!.evidence : {}),
      runId: input.runId ?? null,
      sourceId: input.sourceId ?? null,
      ...(input.taskId ? { lastTaskId: input.taskId } : {}),
      audioOperation,
    },
  })

  if (asset.ownership === 'managed') requireRelatedSourceRealignment(input.neteaseSongId)
  return asset
}

function requireRelatedSourceRealignment(neteaseSongId: number): void {
  getDb().prepare(`
    UPDATE playlist_sources
    SET requires_match_reconcile = 1, updated_at = ?
    WHERE id IN (
      SELECT DISTINCT source_id
      FROM playlist_source_track_occurrences
      WHERE netease_song_id = ? AND membership_status = 'current'
    )
  `).run(new Date().toISOString(), neteaseSongId)
}
