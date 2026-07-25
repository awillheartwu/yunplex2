import { success, fail } from '../../lib/response'
import {
  diagnoseStorageVisibility,
  extractPlexMusicSection,
  resolveConnectionTestConfig,
  testDownloadPathConfig,
} from '../../lib/config/connection-test'
import { ConfigValidationError } from '../../lib/config/validation'
import type { AppConfig, PlexMusicSectionInfo } from '../../lib/config/types'
import { checkCookie } from '../../lib/netease'
import { createPlexClient, initPlexClient } from '../../lib/plex-client'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ section: 'netease' | 'plex' | 'download'; config?: unknown }>(event)

  if (!body.section || !['netease', 'plex', 'download'].includes(body.section)) {
    return fail('缺少测试目标 (netease、plex 或 download)')
  }

  try {
    const config = resolveConnectionTestConfig(body.config)

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
      let section: PlexMusicSectionInfo | null = null
      let inspectionError: string | undefined
      try {
        section = await readConfiguredPlexSection(config)
        if (!section) inspectionError = `未找到音乐库「${config.plex.section}」`
      } catch (err) {
        inspectionError = errorMessage(err)
      }
      const storageVisibility = diagnoseStorageVisibility(config, {
        section,
        ...(inspectionError ? { plexInspectionError: inspectionError } : {}),
      })
      return success(
        { section: 'plex', success: true, machineId, plexSection: section, storageVisibility },
        storageVisibility.status === 'warning'
          ? `Plex 连接正常，但文件发布链路需要确认：${storageVisibility.summary}`
          : `Plex 连接正常 (ID: ${machineId})`,
      )
    }

    if (body.section === 'download') {
      let section: PlexMusicSectionInfo | null = null
      let inspectionError: string | undefined
      if (!config.plex.server || !config.plex.token) {
        inspectionError = '尚未配置 Plex 服务器地址或 Token'
      } else {
        try {
          await initPlexClient(config.plex)
          section = await readConfiguredPlexSection(config)
          if (!section) inspectionError = `未找到音乐库「${config.plex.section}」`
        } catch (err) {
          inspectionError = errorMessage(err)
        }
      }
      const result = testDownloadPathConfig(config, {
        section,
        ...(inspectionError ? { plexInspectionError: inspectionError } : {}),
      })
      return success(
        result,
        result.storageVisibility.status === 'warning'
          ? `下载目录可写，但文件发布链路需要确认：${result.storageVisibility.summary}`
          : '下载目录可写，Plex 文件发布链路已验证',
      )
    }
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      return fail(err.message)
    }
    const message = err instanceof Error ? err.message : '连接失败'
    const label = body.section === 'netease' ? '网易云' : body.section === 'plex' ? 'Plex' : '下载路径'
    return fail(`${label}连接失败: ${message}`)
  }

  return fail('未知测试目标')
})

async function readConfiguredPlexSection(config: AppConfig): Promise<PlexMusicSectionInfo | null> {
  const plex = createPlexClient(config.plex)
  const payload = await plex.query('/library/sections')
  return extractPlexMusicSection(payload, config.plex.section)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '无法读取 Plex 音乐库位置'
}
