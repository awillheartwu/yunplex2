import type { SongIdentityBinding } from '~~/types/match-review'
import type { LocalMediaAsset } from './local-media-store'

export type RedownloadDisposition =
  | 'replace_managed'
  | 'download_missing'
  | 'replace_external'
  | 'skip_external'
  | 'skip_manual_binding'

export interface RedownloadDecision {
  disposition: RedownloadDisposition
  eligible: boolean
  audioPath?: string
}

/**
 * One policy shared by preview and execution. Human identity decisions always
 * win. External media can only be replaced after an explicit takeover choice.
 */
export function decideRedownload(input: {
  asset: LocalMediaAsset | null
  binding: SongIdentityBinding | null
  takeOverExternal: boolean
}): RedownloadDecision {
  if (input.binding?.bindingMethod === 'manual') {
    return { disposition: 'skip_manual_binding', eligible: false }
  }
  if (!input.asset || input.asset.status === 'missing') {
    return { disposition: 'download_missing', eligible: true }
  }
  if (input.asset.ownership === 'managed') {
    return {
      disposition: 'replace_managed',
      eligible: true,
      audioPath: input.asset.filePath,
    }
  }
  if (input.takeOverExternal) {
    return {
      disposition: 'replace_external',
      eligible: true,
      audioPath: input.asset.filePath,
    }
  }
  return { disposition: 'skip_external', eligible: false }
}
