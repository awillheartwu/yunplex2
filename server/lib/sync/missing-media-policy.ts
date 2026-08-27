import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import { validateLocalAudioFile } from '../media-validation'
import { getActiveSongIdentityBindings } from './identity-store'
import {
  inspectLocalMediaAssets,
  type LocalMediaInspection,
} from './local-media-store'

export type MissingMediaDisposition =
  | 'manual_exempt'
  | 'reuse_managed'
  | 'register_managed'
  | 'download_missing'
  | 'redownload_replaced'
  | 'wait_manual'

export interface MissingMediaPlan {
  songId: number
  disposition: MissingMediaDisposition
  inspection: LocalMediaInspection
  filePath: string | null
  audioPath?: string
  protectedAudioPath?: string
  message: string
}

export interface UnverifiedMediaDecision {
  disposition: Extract<MissingMediaDisposition, 'download_missing' | 'wait_manual'>
  message: string
  protectedAudioPath?: string
}

export function decideUnverifiedMedia(
  cfg: AppConfig,
  input: {
    waitMessage: string
    downloadMessage: string
    existingPath?: string | null
    protectExisting?: boolean
  },
): UnverifiedMediaDecision {
  const wait = cfg.sync.unverifiedMediaPolicy === 'wait_manual'
  return {
    disposition: wait ? 'wait_manual' : 'download_missing',
    message: wait ? input.waitMessage : input.downloadMessage,
    ...(input.protectExisting && input.existingPath
      ? { protectedAudioPath: input.existingPath }
      : {}),
  }
}

export function planMissingMedia(
  songs: readonly NeteaseSong[],
  cfg: AppConfig,
  options: { validateAudio: boolean },
): Map<number, MissingMediaPlan> {
  const inspections = inspectLocalMediaAssets(songs, cfg)
  const bindings = getActiveSongIdentityBindings(songs.map(song => song.id))
  const plans = new Map<number, MissingMediaPlan>()

  for (const song of songs) {
    if (plans.has(song.id)) continue
    const inspection = inspections.get(song.id)!
    const binding = bindings.get(song.id)
    if (binding?.bindingMethod === 'manual') {
      plans.set(song.id, plan(song.id, 'manual_exempt', inspection, '人工绑定优先，已豁免自动下载'))
      continue
    }

    if (inspection.state === 'active_managed' || inspection.state === 'active_external') {
      const audioValid = !options.validateAudio
        || Boolean(inspection.filePath && validateLocalAudioFile(inspection.filePath).valid)
      if (audioValid) {
        const managed = inspection.state === 'active_managed'
        plans.set(song.id, managed
          ? plan(song.id, 'reuse_managed', inspection, '复用已验证的 YunPlex 托管媒体')
          : unverifiedPlan(song.id, inspection, cfg, {
              waitMessage: '外部媒体未被明确接管，等待手动选择',
              downloadMessage: '外部媒体未被明确接管，将下载独立托管副本',
              protectExisting: true,
            }))
      } else {
        const managed = inspection.state === 'active_managed'
        plans.set(song.id, managed
          ? {
              ...plan(song.id, 'redownload_replaced', inspection, '托管音频无效，将重新下载'),
              ...(inspection.filePath ? { audioPath: inspection.filePath } : {}),
            }
          : unverifiedPlan(song.id, inspection, cfg, {
              waitMessage: '外部音频无效，等待手动选择',
              downloadMessage: '外部音频无效，将下载新的托管副本',
              protectExisting: true,
            }))
      }
      continue
    }

    if (inspection.state === 'unregistered_managed') {
      if (options.validateAudio && inspection.filePath && !validateLocalAudioFile(inspection.filePath).valid) {
        plans.set(song.id, {
          ...plan(song.id, 'redownload_replaced', inspection, '历史下载文件无效，将安全重新下载'),
          audioPath: inspection.filePath,
        })
        continue
      }
      plans.set(song.id, plan(song.id, 'register_managed', inspection, '将恢复历史下载资产后复用'))
      continue
    }
    if (inspection.state === 'unregistered_external') {
      if (options.validateAudio && inspection.filePath && !validateLocalAudioFile(inspection.filePath).valid) {
        plans.set(song.id, unverifiedPlan(song.id, inspection, cfg, {
          waitMessage: '未登记外部文件无效，等待手动选择',
          downloadMessage: '未登记文件无效，将下载新的托管副本',
          protectExisting: true,
        }))
        continue
      }
      plans.set(song.id, unverifiedPlan(song.id, inspection, cfg, {
        waitMessage: '未登记外部文件等待手动选择',
        downloadMessage: '未登记外部文件不会自动复用，将下载独立托管副本',
        protectExisting: true,
      }))
      continue
    }

    const replaced = inspection.state === 'replaced' && inspection.asset?.ownership === 'managed'
    plans.set(song.id, replaced
      ? {
          ...plan(song.id, 'redownload_replaced', inspection, '托管文件已变化，将安全重新下载'),
          ...(inspection.filePath ? { audioPath: inspection.filePath } : {}),
        }
      : unverifiedPlan(song.id, inspection, cfg, {
          waitMessage: '缺少可验证媒体，等待手动选择',
          downloadMessage: '缺少有效已登记媒体，将直接下载',
        }))
  }

  return plans
}

export function hasMissingMediaPolicyWork(
  songs: readonly NeteaseSong[],
  cfg: AppConfig,
): boolean {
  const plans = planMissingMedia(songs, cfg, { validateAudio: false })
  return [...plans.values()].some(item =>
    !['manual_exempt', 'reuse_managed', 'wait_manual'].includes(item.disposition),
  )
}

function plan(
  songId: number,
  disposition: MissingMediaDisposition,
  inspection: LocalMediaInspection,
  message: string,
): MissingMediaPlan {
  return {
    songId,
    disposition,
    inspection,
    filePath: inspection.filePath,
    message,
  }
}

function unverifiedPlan(
  songId: number,
  inspection: LocalMediaInspection,
  cfg: AppConfig,
  messages: Omit<Parameters<typeof decideUnverifiedMedia>[1], 'existingPath'>,
): MissingMediaPlan {
  const decision = decideUnverifiedMedia(cfg, {
    ...messages,
    existingPath: inspection.filePath,
  })
  return {
    ...plan(songId, decision.disposition, inspection, decision.message),
    ...(decision.protectedAudioPath ? { protectedAudioPath: decision.protectedAudioPath } : {}),
  }
}
