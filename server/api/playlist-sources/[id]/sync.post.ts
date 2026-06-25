import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance, isRepairRunning } from '../../../lib/sync/instance'
import { getSource } from '../../../lib/playlist/store'
import { recordActivityEvent } from '../../../lib/activity/store'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')

  const syncService = getSyncServiceInstance()
  const state = syncService.getState()
  if (state.isRunning) return fail('已有同步任务在运行中，请等待完成')
  if (isRepairRunning()) return fail('补全任务运行中，请等待完成')

  const body = await readBody<{ dryRun?: boolean; forceFull?: boolean; rebuildMatch?: boolean }>(event)
  const dryRun = body?.dryRun ?? false
  const forceFull = body?.forceFull ?? false
  const rebuildMatch = body?.rebuildMatch ?? false

  syncService.runSyncForSource(source.id, { dryRun, forceFull, rebuildMatch, trigger: 'user' }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[YunPlex2] source sync failed:', msg)
  })

  recordActivityEvent({
    domain: 'user',
    type: rebuildMatch ? 'source_rebuild_sync_triggered' : dryRun ? 'source_preview_triggered' : 'source_sync_triggered',
    severity: 'info',
    actor: 'user',
    title: `触发“${source.neteasePlaylistName || source.name}”同步`,
    summary: rebuildMatch
      ? '将先重建匹配缓存，再执行全量同步。'
      : dryRun
        ? '本次仅预览变更，不会真正写入下载与 Plex。'
        : forceFull
          ? '本次按全量模式执行。'
          : '本次按常规策略执行增量同步。',
    context: { sourceId: source.id, sourceName: source.neteasePlaylistName || source.name, dryRun, forceFull, rebuildMatch },
    link: '/task-center?tab=runs',
    groupKey: `source:${source.id}:manual-sync`,
  })

  return success(
    { triggered: true, sourceId: id },
    rebuildMatch ? `歌单源「${source.name}」重建缓存后全量同步已触发` : `歌单源「${source.name}」同步已触发`,
  )
})
