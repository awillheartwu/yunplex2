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

export function resolveDownloadBatchSelection(input: DownloadBatchInput) {
  setArtistAliases(input.config.artistAliases, input.config.applyAliasToAlbum)
  return selectDownloadResource({
    type: input.type,
    resourceId: input.neteaseId,
    selectedSongIds: input.songIds,
    cookie: input.config.cookie,
  })
}

/**
 * Compatibility facade for download callers. Resource adapters resolve one
 * ordered selection; Download Command then atomically persists its run/tasks.
 */
export async function runDownloadBatch(input: DownloadBatchInput): Promise<DownloadBatchResult> {
  const selection = await resolveDownloadBatchSelection(input)
  return createDownloadCommand({
    selection,
    sourceContext: input.sourceContext,
    config: input.config,
  })
}
