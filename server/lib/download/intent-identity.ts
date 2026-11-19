import { getSongIdentityBinding } from '../sync/identity-store'

export interface FileIdentityIntent {
  songId: number
  createdAt?: string
  executionIntent?: { manualBindingVersion?: string | null; managedBindingVersion?: string | null }
}

/** A later explicit choice supersedes a saved write, including same-path replacements. */
export function isFileTaskSupersededByManualBinding(task: FileIdentityIntent): boolean {
  const binding = getSongIdentityBinding(task.songId)
  if (binding?.bindingMethod !== 'manual' || binding.status !== 'active') return false
  const expected = task.executionIntent?.manualBindingVersion
  return expected !== undefined ? binding.updatedAt !== expected
    : Boolean(task.createdAt && binding.updatedAt > task.createdAt)
}

export function assertFileTaskIdentityCurrent(task: FileIdentityIntent): void {
  const expected = task.executionIntent?.managedBindingVersion
  if (expected !== undefined) {
    const binding = getSongIdentityBinding(task.songId)
    if ((binding?.updatedAt ?? null) !== expected || (binding && binding.status !== 'unbound')) {
      throw Object.assign(new Error('媒体关联已变化，请按当前关联重新发起操作'), { code: 'MEDIA_IDENTITY_CONFLICT' })
    }
    return
  }
  if (isFileTaskSupersededByManualBinding(task)) {
    throw Object.assign(new Error('原文件任务已被新的人工媒体选择替代，请按当前关联重新发起操作'), { code: 'MEDIA_IDENTITY_CONFLICT' })
  }
}
