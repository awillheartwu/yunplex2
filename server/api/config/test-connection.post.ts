import { success, fail } from '../../lib/response'
import { readConfig } from '../../lib/config/store'
import { checkCookie } from '../../lib/netease'
import { initPlexClient } from '../../lib/plex-client'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ section: 'netease' | 'plex' }>(event)

  if (!body.section || !['netease', 'plex'].includes(body.section)) {
    return fail('缺少测试目标 (netease 或 plex)')
  }

  const config = readConfig()

  try {
    if (body.section === 'netease') {
      if (!config.netease.cookie) {
        return fail('未配置网易云 Cookie')
      }
      const result = await checkCookie(config.netease.cookie)
      if (result.valid) {
        const nickname = result.profile?.nickname ?? '未知用户'
        return success(
          { section: 'netease', success: true, nickname },
          `网易云音乐连接正常 (${nickname})`,
        )
      }
      return fail('网易云 Cookie 已失效，请重新获取')
    }

    if (body.section === 'plex') {
      if (!config.plex.server || !config.plex.token) {
        return fail('未配置 Plex 服务器地址或 Token')
      }
      const machineId = await initPlexClient(config.plex)
      return success(
        { section: 'plex', success: true, machineId },
        `Plex 连接正常 (ID: ${machineId})`,
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '连接失败'
    return fail(`${body.section === 'netease' ? '网易云' : 'Plex'} 连接失败: ${message}`)
  }

  return fail('未知测试目标')
})
