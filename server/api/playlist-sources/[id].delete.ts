import { success, fail } from '../../lib/response'
import { getSource } from '../../lib/playlist/store'
import { deleteSourceAndStopWork } from '../../lib/playlist/delete-source'
import { getSyncWorker } from '../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  await deleteSourceAndStopWork(id)
  getSyncWorker()?.update()
  return success(null, '歌单源已删除')
})
