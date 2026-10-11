import { getLatestInitialization } from '../../../../lib/source-initialization/store'
import { confirmSharedMedia } from '../../../../lib/source-initialization/shared-media'
import { initializationFailure } from '../../../../lib/source-initialization/errors'
import { fail, success } from '../../../../lib/response'

export default defineEventHandler(async event => {
  const current = getLatestInitialization(getRouterParam(event, 'id') || '')
  const body = await readBody<{initializationId?: string; songId?: number; fingerprint?: string}>(event)
  if (!current || current.id !== body.initializationId) return fail('接管方案已变化，请刷新后重新操作', 409, 'validation_failed')
  if (!Number.isSafeInteger(body.songId) || typeof body.fingerprint !== 'string') return fail('请选择有效的共享媒体组')
  try { return success({ changed: confirmSharedMedia(current.id, body.songId!, body.fingerprint) }, '已确认共享媒体，提交方案后生效') }
  catch (error) { return initializationFailure(error) }
})
