import { success, fail } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { createSource } from '../../lib/playlist/store'
import { getSyncWorker } from '../../lib/sync/instance'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    neteaseId: number
    type: 'playlist' | 'album'
    name?: string
    trackCount?: number
    coverUrl?: string
  }>(event)

  if (!body || !body.neteaseId) {
    return fail('缺少 neteaseId')
  }

  if (!['playlist', 'album'].includes(body.type)) {
    return fail('type 必须为 playlist 或 album')
  }

  const cfg = readConfig()
  if (!cfg.netease.cookie) {
    return fail('请先在设置中配置网易云 Cookie')
  }

  try {
    const source = await createSource(body.neteaseId, cfg.netease.cookie, {
      type: body.type,
      subscribed: false,
      trackCount: body.trackCount,
      name: body.name,
      coverUrl: body.coverUrl,
    })
    getSyncWorker()?.update()

    return success(source, '已保存为同步源')
  } catch (err) {
    const message = err instanceof Error ? err.message : '保存同步源失败'
    return fail(message)
  }
})
