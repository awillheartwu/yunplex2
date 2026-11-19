import { success, fail } from '../../lib/response'
import { reorderSources } from '../../lib/playlist/store'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ orderedIds: string[] }>(event)
  if (!body?.orderedIds || !Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return fail('请提供有效的排序 ID 列表')
  }

  reorderSources(body.orderedIds)
  return success(null, '排序已保存')
})
