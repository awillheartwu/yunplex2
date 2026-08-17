import { success, fail } from '../../../lib/response'
import { getSyncServiceInstance, isRepairRunning } from '../../../lib/sync/instance'
import { getSource } from '../../../lib/playlist/store'
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

  return success(
    { triggered: true, sourceId: id, runId },
    mode === 'redownload_managed'
      ? `歌单源「${source.name}」重新下载托管音频并同步已触发`
      : mode === 'rebuild_matching'
        ? `歌单源「${source.name}」重新评估自动匹配并同步已触发`
        : `歌单源「${source.name}」同步已触发`,
  )
})
