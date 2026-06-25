import { fail, success } from '../../lib/response'
import { getDb } from '../../lib/db'
import type { JobStatus, TaskRunType } from '../../lib/job/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    before: string
    type?: TaskRunType | ''
    status?: JobStatus | ''
  }>(event)
  if (!body?.before || !/^\d{4}-\d{2}-\d{2}$/.test(body.before)) {
    return fail('请选择有效的清理日期')
  }
  const conditions = ["started_at < ?", "status != 'running'"]
  const params: unknown[] = [`${body.before}T00:00:00.000Z`]
  if (body.type) {
    conditions.push('type = ?')
    params.push(body.type)
  }
  if (body.status) {
    conditions.push('status = ?')
    params.push(body.status)
  }
  const where = conditions.join(' AND ')
  const db = getDb()
  const ids = db.prepare(`SELECT id, type FROM task_runs WHERE ${where}`).all(...params) as Array<{ id: string; type: TaskRunType }>
  if (ids.length === 0) return success({ count: 0 }, '没有符合条件的运行记录')

  const transaction = db.transaction(() => {
    const placeholders = ids.map(() => '?').join(',')
    const runIds = ids.map(item => item.id)
    db.prepare(`DELETE FROM task_runs WHERE id IN (${placeholders})`).run(...runIds)
    db.prepare(`DELETE FROM download_tasks WHERE COALESCE(run_id, job_id) IN (${placeholders}) AND status IN ('done','failed')`).run(...runIds)
  })
  transaction()
  return success({ count: ids.length }, `已清理 ${ids.length} 条运行记录`)
})
