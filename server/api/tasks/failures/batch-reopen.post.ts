import { fail, success } from '../../../lib/response'
import { setFailureRecordStatus } from '../../../lib/tasks/failure-records'
import { resolveFailureMutationIds, type FailureMutationSelection } from '../../../lib/tasks/failure-groups'

export default defineEventHandler(async (event) => {
  const body = await readBody<FailureMutationSelection>(event)
  const ids = resolveFailureMutationIds(body, 'ignored')
  if (ids.length === 0) return fail(body?.groupId || body?.allMatching ? '当前选择范围已发生变化，请刷新后再操作' : '请提供要恢复提醒的问题')
  const count = setFailureRecordStatus(ids, 'open')
  return success({ count }, `${count} 个问题已恢复提醒`)
})
