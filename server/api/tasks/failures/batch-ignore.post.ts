import { success, fail } from '../../../lib/response'
import { getDb } from '../../../lib/db'
import { resolveCompositeIds } from '../../../lib/tasks/failure-store'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids: string[] }>(event)

  if (!body?.ids || body.ids.length === 0) {
    return fail('请提供要忽略的失败项 ID 列表')
  }

  const db = getDb()
  const now = new Date().toISOString()

  const taskIds = resolveCompositeIds(body.ids)
  if (taskIds.length === 0) {
    return success({ count: 0 }, '没有找到可忽略的下载任务')
  }

  const idPlaceholders = taskIds.map(() => '?').join(',')
  const result = db.prepare(
    `UPDATE download_tasks SET status = 'done', error = '已忽略', updated_at = ? WHERE id IN (${idPlaceholders}) AND status = 'failed'`,
  ).run(now, ...taskIds)

  return success({ count: result.changes }, `${result.changes} 个失败项已忽略`)
})
