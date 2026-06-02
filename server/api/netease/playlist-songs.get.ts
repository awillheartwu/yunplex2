import { success, fail } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { fetchPlaylistSongs } from '../../lib/netease'

export default defineEventHandler(async (event) => {
  const cfg = readConfig()
  if (!cfg.netease.cookie) return fail('未配置网易云 Cookie')

  const query = getQuery(event)
  const id = parseInt(query.id as string, 10)
  if (!id || isNaN(id)) return fail('缺少歌单 id')

  try {
    const result = await fetchPlaylistSongs(id, undefined, cfg.netease.cookie)
    return success(result)
  } catch (err) {
    return fail(err instanceof Error ? err.message : '获取歌单信息失败')
  }
})
