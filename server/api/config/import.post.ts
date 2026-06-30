import { success, fail } from '../../lib/response'
import { applyConfigUpdate } from '../../lib/config/apply'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)

    // Accept either a full config JSON or legacy yunplex format
    let config: Record<string, unknown> | null = null

    if (body && typeof body === 'object') {
      // Direct config object
      if (body.netease || body.plex || body.download || body.sync || body.other) {
        config = body as Record<string, unknown>
      }
      // Legacy yunplex format or env-var style keys
      else if (body.cookie || body.plex_server || body.YUN_COOKIE || body.PLEX_SERVER ||
               body.SCAN_INTERVAL || body.SONG_LIMIT || body.DOWNLOAD_DIR || body.PLAYLIST) {
        config = convertLegacy(body)
      }
    }

    if (!config) {
      return fail('无效的配置格式，请提供 YunPlex2 配置 JSON 或旧 yunplex 配置')
    }

    const { updated } = applyConfigUpdate(config, {
      title: '导入系统配置',
      type: 'config_imported',
      summaryWhenChanged: (changedKeys) => `本次导入更新了 ${changedKeys.join('、')}`,
      summaryWhenUnchanged: '导入内容与当前配置一致，运行中的调度器已重新检查。',
      groupKey: 'config:import',
    })

    return success(updated, '配置导入成功')
  } catch (err) {
    const message = err instanceof Error ? err.message : '导入失败'
    return fail(message)
  }
})

function convertLegacy(legacy: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = { netease: {}, plex: {}, download: {}, sync: {} }

  const netease = config.netease as Record<string, unknown>
  if (legacy.cookie) netease.cookie = legacy.cookie
  if (legacy.YUN_COOKIE) netease.cookie = legacy.YUN_COOKIE
  if (legacy.quality) netease.quality = legacy.quality
  if (legacy.LEVEL) {
    const levelMap: Record<string, string> = {
      ['标准']: 'standard', ['较高']: 'higher', ['极高']: 'exhigh',
      ['无损']: 'lossless', ['Hi-Res']: 'hires', ['高清环绕声']: 'jyeffect', ['超清母带']: 'jymaster',
    }
    netease.quality = levelMap[legacy.LEVEL as string] ?? 'jymaster'
  }

  const plex = config.plex as Record<string, unknown>
  if (legacy.plex_server) plex.server = legacy.plex_server
  if (legacy.PLEX_SERVER) plex.server = legacy.PLEX_SERVER
  if (legacy.plex_port) plex.port = readLegacyNumber(legacy.plex_port, 'plex_port')
  if (legacy.PLEX_PORT) plex.port = readLegacyNumber(legacy.PLEX_PORT, 'PLEX_PORT')
  if (legacy.plex_token) plex.token = legacy.plex_token
  if (legacy.PLEX_TOKEN) plex.token = legacy.PLEX_TOKEN
  if (legacy.plex_section) plex.section = legacy.plex_section
  if (legacy.PLEX_SECTION) plex.section = legacy.PLEX_SECTION

  const dl = config.download as Record<string, unknown>
  if (legacy.download_dir) dl.dir = legacy.download_dir
  if (legacy.DOWNLOAD_DIR) dl.dir = legacy.DOWNLOAD_DIR

  const sync = config.sync as Record<string, unknown>
  if (legacy.scan_interval) sync.intervalMinutes = readLegacyNumber(legacy.scan_interval, 'scan_interval')
  if (legacy.SCAN_INTERVAL) sync.intervalMinutes = readLegacyNumber(legacy.SCAN_INTERVAL, 'SCAN_INTERVAL')
  if (legacy.song_limit) sync.songLimit = readLegacyNumber(legacy.song_limit, 'song_limit')
  if (legacy.SONG_LIMIT) sync.songLimit = readLegacyNumber(legacy.SONG_LIMIT, 'SONG_LIMIT')

  return config
}

function readLegacyNumber(value: unknown, key: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) {
    throw new Error(`旧配置字段 ${key} 必须是有效数字`)
  }
  return parsed
}
