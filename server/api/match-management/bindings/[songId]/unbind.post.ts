import { fail, success } from '../../../../lib/response'
import {
  BindingVersionConflictError,
  unbindSongIdentityWithMode,
} from '../../../../lib/sync/identity-store'
import { acquireIdentityMutationLock } from '../../../../lib/sync/identity-coordinator'

export default defineEventHandler(async (event) => {
  const songId = Number(getRouterParam(event, 'songId'))
  if (!Number.isSafeInteger(songId) || songId <= 0) return fail('无效的网易云歌曲 ID')
  const body = await readBody<{
    expectedBindingUpdatedAt?: string
    mode?: 'reevaluate' | 'exclude_current'
    sourceId?: string
  }>(event)
  if (body.mode !== 'reevaluate' && body.mode !== 'exclude_current') {
    return fail('mode 必须是 reevaluate 或 exclude_current')
  }
  if (!body.expectedBindingUpdatedAt) return fail('缺少绑定版本，请刷新后重试')
  try {
    const release = await acquireIdentityMutationLock()
    try {
      return success(unbindSongIdentityWithMode({
        neteaseSongId: songId,
        expectedBindingUpdatedAt: body.expectedBindingUpdatedAt,
        mode: body.mode,
        sourceId: body.sourceId,
      }), body.mode === 'exclude_current'
        ? '已排除此文件并等待重新匹配'
        : '已解除绑定并允许系统重新评估')
    } finally {
      release()
    }
  } catch (error) {
    if (error instanceof BindingVersionConflictError) setResponseStatus(event, 409)
    return fail(error instanceof Error ? error.message : '解绑失败', error instanceof BindingVersionConflictError ? 409 : 1)
  }
})
