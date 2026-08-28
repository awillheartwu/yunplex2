import { success, fail } from '../../lib/response'
import { getSource, deleteSource } from '../../lib/playlist/store'
import { getSyncWorker } from '../../lib/sync/instance'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  deleteSource(id)
  getSyncWorker()?.update()
  return success(null, '歌单源已删除')
})
