import type { DomainErrorCode } from '../../../shared/domain-errors'
import type { AppConfig, PlexMusicSectionInfo } from './types'
import { diagnoseStorageVisibility, extractPlexMusicSection, resolveConnectionTestConfig, testDownloadPathConfig } from './connection-test'
import { ConnectionTestError } from './connection-test-error'
import { checkCookie } from '../netease'
import { createPlexClient, initPlexClient } from '../plex-client'
import { sanitizeDiagnosticMessage } from '../domain-error'

export type ConnectionTestSection = 'netease' | 'plex' | 'download'
export interface ConnectionTestResult { section: ConnectionTestSection; message: string; data: Record<string, unknown> }

/** Deadline for one connection test. The external library calls below cannot be cancelled. */
export const CONNECTION_TEST_TIMEOUT_MS = 15_000

const TIMEOUT_FAILURES: Record<ConnectionTestSection, { code: DomainErrorCode; message: string }> = {
  netease: { code: 'netease_unavailable', message: '网易云连接测试超过 15 秒未返回，已停止等待；请检查网络或代理后重试。' },
  plex: { code: 'plex_unavailable', message: 'Plex 连接测试超过 15 秒未返回，已停止等待；请检查服务器地址、端口和网络后重试。' },
  download: { code: 'filesystem_failed', message: '下载目录检查超过 15 秒未返回，已停止等待；请确认目录所在存储挂载正常后重试。' },
}

export function assertConnectionTestSection(value: unknown): ConnectionTestSection {
  if (value === 'netease' || value === 'plex' || value === 'download') return value
  throw new Error('未知的连接测试项')
}

export async function runConnectionTest(section: ConnectionTestSection, candidate?: unknown): Promise<ConnectionTestResult> {
  const config = resolveConnectionTestConfig(candidate)
  return withBoundedWait(section, () => {
    if (section === 'netease') return testNetease(config)
    if (section === 'plex') return testPlex(config)
    return testDownload(config)
  })
}

/**
 * Bounds how long a connection test may take and clears the deadline timer in `finally`. The
 * pending library request keeps running in the background: this is a bounded wait, not transport
 * cancellation, and it never retries on its own.
 */
async function withBoundedWait<T>(section: ConnectionTestSection, run: () => Promise<T>): Promise<T> {
  const pending = run()
  // The deadline may win first; keep a late rejection from surfacing as an unhandled rejection.
  pending.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        const failure = TIMEOUT_FAILURES[section]
        timer = setTimeout(() => reject(new ConnectionTestError(failure.code, failure.message)), CONNECTION_TEST_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function testNetease(config: AppConfig): Promise<ConnectionTestResult> {
  if (!config.netease.cookie) throw new ConnectionTestError('validation_failed', '未配置网易云 Cookie')
  const result = await checkCookie(config.netease.cookie)
  if (result.networkError) throw new ConnectionTestError('netease_unavailable', '网易云网络异常：连接网易云服务失败或超时，请检查网络或代理后重试；这不是 Cookie 失效。')
  if (!result.valid) throw new ConnectionTestError('authentication_failed', '网易云 Cookie 已失效，请重新获取')
  const nickname = result.profile?.nickname ?? '未知用户'
  return { section: 'netease', message: `网易云音乐连接正常 (${nickname})`, data: { section: 'netease', success: true, nickname, userId: result.profile?.userId ?? null } }
}

async function testPlex(config: AppConfig): Promise<ConnectionTestResult> {
  if (!config.plex.server || !config.plex.token) throw new ConnectionTestError('validation_failed', '未配置 Plex 服务器地址或 Token')
  const machineId = await connectPlex(config)
  const inspection = await inspectPlexSection(config)
  const storageVisibility = diagnoseStorageVisibility(config, inspection)
  return {
    section: 'plex',
    message: storageVisibility.status === 'warning' ? `Plex 连接正常，但文件发布链路需要确认：${storageVisibility.summary}` : `Plex 连接正常 (ID: ${machineId})`,
    data: { section: 'plex', success: true, machineId, plexSection: inspection.section ?? null, storageVisibility },
  }
}

async function connectPlex(config: AppConfig): Promise<string> {
  try {
    return await initPlexClient(config.plex)
  } catch (error) {
    throw plexConnectionFailure(config, error)
  }
}

/**
 * Builds Plex context from the configured target only. plex-api internals are never echoed, so a
 * rejected request can never carry the configured token into the response.
 */
function plexConnectionFailure(config: AppConfig, error: unknown): ConnectionTestError {
  // The server field is free text; redact credential-shaped fragments before building context.
  const target = sanitizeDiagnosticMessage(`${config.plex.server}:${config.plex.port}`) ?? `端口 ${config.plex.port}`
  const reason = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').toLowerCase()
  if (reason.includes('permission') || reason.includes('403')) {
    return new ConnectionTestError('plex_unavailable', `Plex 拒绝访问（${target}）：当前账号缺少该音乐库权限，请检查 Plex 共享权限后重试。`)
  }
  if (reason.includes('401') || reason.includes('authenticate') || reason.includes('denied request')) {
    return new ConnectionTestError('plex_unavailable', `Plex 拒绝访问（${target}）：Token 无效或未授权，请在 Plex 中重新获取 Token 后重试。`)
  }
  if (/econnrefused|ehostunreach|enetunreach|enotfound|eai_again|econnreset/.test(reason)) {
    return new ConnectionTestError('plex_unavailable', `无法连接 Plex（${target}）：请检查服务器地址、端口以及 Plex 服务是否在运行。`)
  }
  if (/etimedout|esockettimedout|timeout|socket hang up|econnaborted/.test(reason)) {
    return new ConnectionTestError('plex_unavailable', `Plex 连接超时（${target}）：请检查服务器与网络状态后重试。`)
  }
  return new ConnectionTestError('plex_unavailable', `Plex 连接失败（${target}）：无法读取服务器信息，请检查地址、端口和 Token。`)
}

async function testDownload(config: AppConfig): Promise<ConnectionTestResult> {
  const inspection = config.plex.server && config.plex.token
    ? await inspectDownloadPlexSection(config)
    : { section: null, plexInspectionError: '尚未配置 Plex 服务器地址或 Token' }
  const result = testDownloadPathConfig(config, inspection)
  return {
    section: 'download',
    message: result.storageVisibility.status === 'warning' ? `下载目录可写，但文件发布链路需要确认：${result.storageVisibility.summary}` : '下载目录可写，Plex 文件发布链路已验证',
    data: { ...result, dir: result.downloadDir } as unknown as Record<string, unknown>,
  }
}

async function inspectDownloadPlexSection(config: AppConfig) {
  try {
    await initPlexClient(config.plex)
    return await inspectPlexSection(config)
  } catch (error) {
    return { section: null, plexInspectionError: error instanceof Error ? error.message : '无法连接 Plex' }
  }
}

async function inspectPlexSection(config: AppConfig): Promise<{ section: PlexMusicSectionInfo | null; plexInspectionError?: string }> {
  try {
    const plex = createPlexClient(config.plex)
    const payload = await plex.query('/library/sections')
    const section = extractPlexMusicSection(payload, config.plex.section)
    return section ? { section } : { section: null, plexInspectionError: `未找到音乐库「${config.plex.section}」` }
  } catch (error) {
    return { section: null, plexInspectionError: error instanceof Error ? error.message : '无法读取 Plex 音乐库位置' }
  }
}
