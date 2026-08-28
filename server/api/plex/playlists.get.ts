import { success, fail } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { initPlexClient, listPlaylists } from '../../lib/plex-client'

export default defineEventHandler(async () => {
  const cfg = readConfig()
  if (!cfg.plex.server || !cfg.plex.token) return fail('未配置 Plex 服务器')

  try {
    await initPlexClient(cfg.plex)
    const playlists = await listPlaylists()
    return success(playlists)
  } catch (err) {
    return fail(err, 1, 'plex_unavailable')
  }
})
