import { setArtistAliases } from '../netease'
import type { DownloadResourceType } from './resource-selection'
import { selectDownloadResource } from './resource-selection'
import {
  createDownloadCommand,
  type DownloadCommandConfig,
  type DownloadCommandResult,
} from './download-command'

export type DownloadBatchConfig = DownloadCommandConfig

export interface DownloadBatchInput {
  type: DownloadResourceType
  neteaseId?: number
  songIds?: number[]
  sourceContext?: { id: string; name: string }
  config: DownloadBatchConfig
}

export type DownloadBatchResult = DownloadCommandResult

/**
 * Compatibility facade for download callers. Resource adapters resolve one
 * ordered selection; Download Command then atomically persists its run/tasks.
 */
export async function runDownloadBatch(input: DownloadBatchInput): Promise<DownloadBatchResult> {
  setArtistAliases(input.config.artistAliases, input.config.applyAliasToAlbum)
  const selection = await selectDownloadResource({
    type: input.type,
    resourceId: input.neteaseId,
    selectedSongIds: input.songIds,
    cookie: input.config.cookie,
  })
  return createDownloadCommand({
    selection,
    sourceContext: input.sourceContext,
    config: input.config,
  })
}
