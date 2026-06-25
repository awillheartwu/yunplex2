import { fail, success } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { getRecentlyAddedTracks, getSectionKey, initPlexClient } from '../../lib/plex-client'
import type { PlexRecentItem } from '~~/types/dashboard'

async function fetchThumbDataUrl(baseUrl: string, token: string, thumbPath: string | undefined): Promise<string | null> {
  if (!thumbPath) return null
  try {
    const separator = thumbPath.includes('?') ? '&' : '?'
    const res = await fetch(`${baseUrl}${thumbPath}${separator}X-Plex-Token=${encodeURIComponent(token)}`)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buffer = Buffer.from(await res.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const cfg = readConfig()
  if (!cfg.plex.server || !cfg.plex.token || !cfg.plex.section) return fail('未配置 Plex 服务器')

  const query = getQuery(event)
  const limit = Math.min(parseInt(query.limit as string, 10) || 5, 10)

  try {
    await initPlexClient(cfg.plex)
    const sectionKey = await getSectionKey(cfg.plex.section)
    if (!sectionKey) return fail('未找到 Plex 音乐库分区')

    const items = await getRecentlyAddedTracks(sectionKey, limit)
    const baseUrl = `http://${cfg.plex.server}:${cfg.plex.port}`
    const data = await Promise.all(items.map(async (item) => ({
      ratingKey: item.ratingKey,
      title: item.title,
      artist: item.grandparentTitle,
      album: item.parentTitle,
      addedAt: item.addedAt
        ? new Date(typeof item.addedAt === 'string' ? Number.parseInt(item.addedAt, 10) * 1000 : item.addedAt * 1000).toISOString()
        : null,
      thumb: await fetchThumbDataUrl(baseUrl, cfg.plex.token, item.thumb),
    } satisfies PlexRecentItem)))

    return success(data)
  } catch (err) {
    return fail(err instanceof Error ? err.message : '获取 Plex 最近添加失败')
  }
})
