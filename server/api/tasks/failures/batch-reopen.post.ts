import { fail, success } from '../../../lib/response'
import { setFailureRecordStatus } from '../../../lib/tasks/failure-records'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids: string[] }>(event)
  if (!body?.ids?.length) return fail('请提供要恢复提醒的问题')
  const count = setFailureRecordStatus(body.ids, 'open')
  return success({ count }, `${count} 个问题已恢复提醒`)
})
