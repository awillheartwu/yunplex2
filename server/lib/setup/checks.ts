import { accessSync, constants, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig } from '../config/types'
import { resolveConnectionTestConfig } from '../config/connection-test'
import { checkCookie } from '../netease'
import { initPlexClient } from '../plex-client'
import { randomToken } from '../auth/crypto'

export type SetupCheckKey = 'netease' | 'plex' | 'download'

export interface SetupCheckResult {
  key: SetupCheckKey
  ok: boolean
  message: string
  detail?: Record<string, unknown>
}

export const SETUP_CHECKS: SetupCheckKey[] = ['netease', 'plex', 'download']

export async function runSetupCheck(key: SetupCheckKey, candidate?: unknown): Promise<SetupCheckResult> {
  const config = resolveConnectionTestConfig(candidate)
  switch (key) {
    case 'netease':
      return checkNetease(config)
    case 'plex':
      return checkPlex(config)
    case 'download':
      return checkDownloadDir(config)
  }
}

export async function runRequiredSetupChecks(candidate?: unknown): Promise<SetupCheckResult[]> {
  const results: SetupCheckResult[] = []
  for (const key of SETUP_CHECKS) {
    results.push(await runSetupCheck(key, candidate))
  }
  return results
}

export function assertSetupCheckKey(value: unknown): SetupCheckKey {
  if (value === 'netease' || value === 'plex' || value === 'download') return value
  throw new Error('未知的初始化检查项')
}

async function checkNetease(config: AppConfig): Promise<SetupCheckResult> {
  if (!config.netease.cookie) {
    return { key: 'netease', ok: false, message: '未配置网易云 Cookie' }
  }

  const result = await checkCookie(config.netease.cookie)
  if (!result.valid) {
    return { key: 'netease', ok: false, message: '网易云 Cookie 已失效，请重新获取' }
  }

  return {
    key: 'netease',
    ok: true,
    message: `网易云音乐连接正常 (${result.profile?.nickname ?? '未知用户'})`,
    detail: { nickname: result.profile?.nickname ?? null, userId: result.profile?.userId ?? null },
  }
}

async function checkPlex(config: AppConfig): Promise<SetupCheckResult> {
  if (!config.plex.server || !config.plex.token) {
    return { key: 'plex', ok: false, message: '未配置 Plex 服务器地址或 Token' }
  }

  const machineId = await initPlexClient(config.plex)
  return {
    key: 'plex',
    ok: true,
    message: `Plex 连接正常 (ID: ${machineId})`,
    detail: { machineId },
  }
}

function checkDownloadDir(config: AppConfig): SetupCheckResult {
  const dir = config.download.dir?.trim()
  if (!dir) {
    return { key: 'download', ok: false, message: '未配置下载目录' }
  }

  mkdirSync(dir, { recursive: true })
  accessSync(dir, constants.W_OK)
  const probePath = join(dir, `.yunplex-write-test-${randomToken(8)}`)
  writeFileSync(probePath, 'ok')
  unlinkSync(probePath)

  return {
    key: 'download',
    ok: true,
    message: '下载目录可写',
    detail: { dir },
  }
}
