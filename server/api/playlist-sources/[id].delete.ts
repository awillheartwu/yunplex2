import { success, fail } from '../../lib/response'
import { getSource, deleteSource } from '../../lib/playlist/store'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  if (!getSource(id)) return fail('歌单源不存在')

  deleteSource(id)
  return success(null, '歌单源已删除')
})
