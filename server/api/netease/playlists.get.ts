import { success, fail } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { fetchUserPlaylists, checkCookie } from '../../lib/netease'

export default defineEventHandler(async (event) => {
  const cfg = readConfig()
  if (!cfg.netease.cookie) return fail('未配置网易云 Cookie')

  const cookieCheck = await checkCookie(cfg.netease.cookie)
  if (!cookieCheck.valid || !cookieCheck.profile) return fail('Cookie 已失效')

  const query = getQuery(event)
  const offset = parseInt(query.offset as string, 10) || 0
  const limit = 100

  try {
    const playlists = await fetchUserPlaylists(cookieCheck.profile.userId, cfg.netease.cookie, limit, offset)
    return success(playlists)
  } catch (err) {
    return fail(err instanceof Error ? err.message : '获取歌单列表失败')
  }
})
