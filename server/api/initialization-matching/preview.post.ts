import { success, fail } from '../../lib/response'
import { validateInitializationMatching } from '../../lib/config/initialization-matching-validation'
import { previewMatching } from '../../lib/source-initialization/matching-preview'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    if (!body || typeof body.sourceId !== 'string' || !body.sourceId || (body.snapshotId !== undefined && typeof body.snapshotId !== 'string')) return fail('请选择歌单和有效的试算快照')
    const config = validateInitializationMatching(body.config)
    if (body.initializationId !== undefined && typeof body.initializationId !== 'string') return fail('无效的接管草案 ID')
    return success(await previewMatching({ sourceId: body.sourceId, config, snapshotId: body.snapshotId, initializationId: body.initializationId }))
  } catch (error) { return fail(error instanceof Error ? error.message : '匹配试算失败') }
})
