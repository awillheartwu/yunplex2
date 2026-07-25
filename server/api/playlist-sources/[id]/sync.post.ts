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

  const body = await readBody<{
    dryRun?: boolean
    forceFull?: boolean
    rebuildMatch?: boolean
    redownloadAll?: boolean
    takeOverExternal?: boolean
  }>(event)
  const dryRun = body?.dryRun ?? false
  const forceFull = body?.forceFull ?? false
  const rebuildMatch = body?.rebuildMatch ?? false
  const redownloadAll = body?.redownloadAll ?? false
  const takeOverExternal = body?.takeOverExternal ?? false
  if (redownloadAll && source.type !== 'playlist') return fail('重新下载全部音频仅支持歌单同步源')
  if (redownloadAll && dryRun) return fail('重新下载全部音频不能与预览模式同时使用')
  if (redownloadAll && rebuildMatch) return fail('重新下载全部音频不能与重建匹配同时执行')

  const { runId } = syncService.startSyncForSource(source.id, {
    dryRun,
    forceFull,
    rebuildMatch,
    redownloadAll,
    takeOverExternal,
    trigger: 'user',
  })

  recordActivityEvent({
    domain: 'user',
    type: redownloadAll ? 'source_redownload_sync_triggered' : rebuildMatch ? 'source_rebuild_sync_triggered' : dryRun ? 'source_preview_triggered' : 'source_sync_triggered',
    severity: redownloadAll ? 'warning' : 'info',
    actor: 'user',
    title: `触发“${source.neteasePlaylistName || source.name}”同步`,
    summary: redownloadAll
      ? `将重新下载当前同步范围内由 YunPlex 管理的音频并同步；外部文件${takeOverExternal ? '已明确允许接管替换' : '会受到保护'}，人工绑定不会被覆盖。`
      : rebuildMatch
      ? '将先重建匹配缓存，再执行全量同步。'
      : dryRun
        ? '本次仅预览变更，不会真正写入下载与 Plex。'
        : forceFull
          ? '本次按全量模式执行。'
          : '本次按常规策略执行增量同步。',
    context: {
      sourceId: source.id,
      sourceName: source.neteasePlaylistName || source.name,
      dryRun,
      forceFull,
      rebuildMatch,
      redownloadAll,
      takeOverExternal,
      jobId: runId,
    },
    link: `/task-center/runs/${runId}`,
    groupKey: `source:${source.id}:manual-sync`,
  })

  return success(
    { triggered: true, sourceId: id, runId },
    redownloadAll
      ? `歌单源「${source.name}」重新下载全部音频并同步已触发`
      : rebuildMatch
        ? `歌单源「${source.name}」重建缓存后全量同步已触发`
        : `歌单源「${source.name}」同步已触发`,
  )
})
