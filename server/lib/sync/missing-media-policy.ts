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

export interface MissingMediaPlan {
  songId: number
  disposition: MissingMediaDisposition
  inspection: LocalMediaInspection
  filePath: string | null
  audioPath?: string
  protectedAudioPath?: string
  message: string
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
          : {
              ...plan(song.id, 'download_missing', inspection, '外部媒体未被明确接管，将下载独立托管副本'),
              ...(inspection.filePath ? { protectedAudioPath: inspection.filePath } : {}),
            })
      } else {
        const managed = inspection.state === 'active_managed'
        plans.set(song.id, {
          ...plan(
            song.id,
            managed ? 'redownload_replaced' : 'download_missing',
            inspection,
            managed ? '托管音频无效，将重新下载' : '外部音频无效，将下载新的托管副本',
          ),
          ...(managed && inspection.filePath ? { audioPath: inspection.filePath } : {}),
          ...(!managed && inspection.filePath ? { protectedAudioPath: inspection.filePath } : {}),
        })
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
        plans.set(song.id, {
          ...plan(song.id, 'download_missing', inspection, '未登记文件无效，将下载新的托管副本'),
          protectedAudioPath: inspection.filePath,
        })
        continue
      }
      plans.set(song.id, {
        ...plan(song.id, 'download_missing', inspection, '未登记外部文件不会自动复用，将下载独立托管副本'),
        ...(inspection.filePath ? { protectedAudioPath: inspection.filePath } : {}),
      })
      continue
    }

    const replaced = inspection.state === 'replaced' && inspection.asset?.ownership === 'managed'
    plans.set(song.id, {
      ...plan(
        song.id,
        replaced ? 'redownload_replaced' : 'download_missing',
        inspection,
        replaced ? '托管文件已变化，将安全重新下载' : '缺少有效已登记媒体，将直接下载',
      ),
      ...(replaced && inspection.filePath ? { audioPath: inspection.filePath } : {}),
    })
  }

  return plans
}

export function hasMissingMediaPolicyWork(
  songs: readonly NeteaseSong[],
  cfg: AppConfig,
): boolean {
  const plans = planMissingMedia(songs, cfg, { validateAudio: false })
  return [...plans.values()].some(item =>
    !['manual_exempt', 'reuse_managed'].includes(item.disposition),
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
