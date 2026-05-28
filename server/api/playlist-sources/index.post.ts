import { success, fail } from '../../lib/response'
import { listSources, createSource } from '../../lib/playlist/store'
import { readConfig } from '../../lib/config/store'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ neteasePlaylistId: number }>(event)
  if (!body?.neteasePlaylistId || typeof body.neteasePlaylistId !== 'number') {
    return fail('请提供有效的歌单 ID')
  }

  const existing = listSources()
  if (existing.some(s => s.neteasePlaylistId === body.neteasePlaylistId)) {
    return fail('该歌单 ID 已存在')
  }

  try {
    const cfg = readConfig()
    const source = await createSource(body.neteasePlaylistId, cfg.netease.cookie)
    return success(source, '歌单源添加成功')
  } catch (err) {
    const msg = err instanceof Error ? err.message : '创建歌单源失败'
    return fail(msg)
  }
})
