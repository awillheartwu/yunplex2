import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance, isRepairRunning } from '../../../lib/sync/instance'
import { getSource } from '../../../lib/playlist/store'
import { recordActivityEvent } from '../../../lib/activity/store'
import { isSyncMode, type SyncMode } from '../../../lib/sync/service-state'

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
    mode?: SyncMode
    takeOverExternal?: boolean
  }>(event)
  const mode = body?.mode
  const takeOverExternal = body?.takeOverExternal ?? false
  if (!isSyncMode(mode)) return fail('无效的同步模式')
  if (mode === 'redownload_managed' && source.type !== 'playlist') return fail('重新下载托管音频仅支持歌单同步源')
  if (takeOverExternal && mode !== 'redownload_managed') return fail('仅重新下载托管音频模式允许接管外部文件')

  const { runId } = syncService.startSyncForSource(source.id, {
    mode,
    takeOverExternal,
    trigger: 'user',
  })

  recordActivityEvent({
    domain: 'user',
    type: mode === 'redownload_managed' ? 'source_redownload_sync_triggered' : mode === 'rebuild_matching' ? 'source_rebuild_sync_triggered' : mode === 'preview' ? 'source_preview_triggered' : 'source_sync_triggered',
    severity: mode === 'redownload_managed' ? 'warning' : 'info',
    actor: 'user',
    title: `触发“${source.neteasePlaylistName || source.name}”同步`,
    summary: mode === 'redownload_managed'
      ? `将重新下载当前同步范围内由 YunPlex 管理的音频并同步；外部文件${takeOverExternal ? '已明确允许接管替换' : '会受到保护'}，人工绑定不会被覆盖。`
      : mode === 'rebuild_matching'
      ? '将保留人工决定、失效自动绑定并重新评估，再执行全量同步。'
      : mode === 'preview'
        ? '本次仅预览变更，不会真正写入下载与 Plex。'
        : mode === 'full'
          ? '本次按全量模式执行。'
          : '本次按常规策略执行增量同步。',
    context: {
      sourceId: source.id,
      sourceName: source.neteasePlaylistName || source.name,
      mode,
      takeOverExternal,
      jobId: runId,
    },
    link: `/task-center/runs/${runId}`,
    groupKey: `source:${source.id}:manual-sync`,
  })

  return success(
    { triggered: true, sourceId: id, runId },
    mode === 'redownload_managed'
      ? `歌单源「${source.name}」重新下载托管音频并同步已触发`
      : mode === 'rebuild_matching'
        ? `歌单源「${source.name}」重新评估自动匹配并同步已触发`
        : `歌单源「${source.name}」同步已触发`,
  )
})
