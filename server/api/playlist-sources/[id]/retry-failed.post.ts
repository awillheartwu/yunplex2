import { success, fail } from '../../../lib/response'
import { getSource } from '../../../lib/playlist/store'
import { getDb } from '../../../lib/db'
import { retryFailureRecords } from '../../../lib/tasks/retry'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少歌单源 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  const rows = getDb().prepare("SELECT id FROM failure_records WHERE source_id = ? AND status = 'open'")
    .all(source.id) as { id: string }[]
  if (!rows.length) return fail('该同步源没有可重新尝试的异常')
  try {
    const result = retryFailureRecords(rows.map(row => row.id))
    return success(result, `已提交 ${result.count} 项重新处理`)
  } catch (error) {
    return fail(error, 1, 'validation_failed')
  }
})
