import { success, fail } from '../../lib/response'
import { listSources, reorderSources } from '../../lib/playlist/store'
import { recordActivityEvent } from '../../lib/activity/store'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ orderedIds: string[] }>(event)
  if (!body?.orderedIds || !Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return fail('请提供有效的排序 ID 列表')
  }

  reorderSources(body.orderedIds)
  const orderedNames = listSources()
    .filter((source) => body.orderedIds.includes(source.id))
    .map((source) => source.neteasePlaylistName || source.name)
    .slice(0, 3)
  recordActivityEvent({
    domain: 'user',
    type: 'source_reordered',
    severity: 'info',
    actor: 'user',
    title: '调整同步源顺序',
    summary: orderedNames.length > 0 ? `首页与同步流程将按新顺序展示，前列包括：${orderedNames.join('、')}` : '同步源顺序已更新。',
    context: { orderedIds: body.orderedIds },
    link: '/sync-sources',
    groupKey: 'source:reorder',
  })
  return success(null, '排序已保存')
})
