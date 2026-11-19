import { success, fail } from '../../../lib/response'
import { retryFailureRecords } from '../../../lib/tasks/retry'
import { resolveFailureMutationIds, type FailureMutationSelection } from '../../../lib/tasks/failure-groups'

export default defineEventHandler(async (event) => {
  const body = await readBody<FailureMutationSelection>(event)
  const ids = resolveFailureMutationIds(body, ['open', 'ignored'])

  if (ids.length === 0) {
    return fail(body?.groupId || body?.allMatching ? '当前选择范围已发生变化，请刷新后再操作' : '请提供要重试的失败项 ID 列表')
  }

  try {
    const result = retryFailureRecords(ids)
    return success(result, `已提交 ${result.count} 项重新处理`)
  } catch (error) {
    return fail(error, 1, 'validation_failed')
  }
})
