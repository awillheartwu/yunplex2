import { success, fail } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { checkCookie, fetchUserAlbums } from '../../lib/netease'

export default defineEventHandler(async (event) => {
  const cfg = readConfig()
  if (!cfg.netease.cookie) return fail('请先配置网易云 Cookie')

  const check = await checkCookie(cfg.netease.cookie)
  if (!check.valid) return fail('网易云 Cookie 已失效，请重新获取并更新配置')
  const uid = check.profile?.userId

  const query = getQuery(event)
  const limit = query.limit ? parseInt(query.limit as string, 10) : 100
  const offset = query.offset ? parseInt(query.offset as string, 10) : 0

  try {
    const albums = await fetchUserAlbums(cfg.netease.cookie, uid, limit, offset)
    return success(albums)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '获取专辑列表失败'
    return fail(msg)
  }
})
