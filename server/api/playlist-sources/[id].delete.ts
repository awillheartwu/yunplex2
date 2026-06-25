import { success, fail } from '../../lib/response'
import { getSource, deleteSource } from '../../lib/playlist/store'
import { recordActivityEvent } from '../../lib/activity/store'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  deleteSource(id)
  recordActivityEvent({
    domain: 'user',
    type: 'source_deleted',
    severity: 'warning',
    actor: 'user',
    title: `删除同步源“${source.neteasePlaylistName || source.name}”`,
    summary: '同步源及其关联下载记录已从控制台移除。',
    context: { sourceId: source.id, sourceName: source.neteasePlaylistName || source.name },
    link: '/sync-sources',
    groupKey: `source:${source.id}`,
  })
  return success(null, '歌单源已删除')
})
