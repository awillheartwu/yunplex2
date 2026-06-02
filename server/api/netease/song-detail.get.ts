import { success, fail } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { fetchSongDetail } from '../../lib/netease'

export default defineEventHandler(async (event) => {
  const cfg = readConfig()
  if (!cfg.netease.cookie) return fail('未配置网易云 Cookie')

  const query = getQuery(event)
  const id = parseInt(query.id as string, 10)
  if (!id || isNaN(id)) return fail('缺少歌曲 id')

  try {
    const song = await fetchSongDetail(id, cfg.netease.cookie)
    return success(song)
  } catch (err) {
    return fail(err instanceof Error ? err.message : '获取歌曲信息失败')
  }
})
