import { success, fail } from '../../../lib/response'
import { setFailureRecordStatus } from '../../../lib/tasks/failure-records'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids: string[] }>(event)

  if (!body?.ids || body.ids.length === 0) {
    return fail('请提供要忽略的失败项 ID 列表')
  }

  const count = setFailureRecordStatus(body.ids, 'ignored')
  return success({ count }, `${count} 个问题已忽略`)
})
