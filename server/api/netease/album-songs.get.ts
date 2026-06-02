import { success, fail } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { fetchAlbumSongs, fetchAlbumDetail } from '../../lib/netease'

export default defineEventHandler(async (event) => {
  const cfg = readConfig()
  if (!cfg.netease.cookie) return fail('未配置网易云 Cookie')

  const query = getQuery(event)
  const id = parseInt(query.id as string, 10)
  if (!id || isNaN(id)) return fail('缺少专辑 id')

  try {
    const [songs, album] = await Promise.all([
      fetchAlbumSongs(id, cfg.netease.cookie),
      fetchAlbumDetail(id, cfg.netease.cookie),
    ])
    return success({ songs, album })
  } catch (err) {
    return fail(err instanceof Error ? err.message : '获取专辑信息失败')
  }
})
