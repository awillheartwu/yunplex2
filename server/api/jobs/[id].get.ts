import { success, fail } from '../../lib/response'
import { getJob } from '../../lib/job/store'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少任务 ID')

  const job = getJob(id)
  if (job) return success(job)

  return fail('任务不存在')
})
