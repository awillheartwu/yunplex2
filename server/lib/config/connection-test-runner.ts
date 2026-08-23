import type { AppConfig, PlexMusicSectionInfo } from './types'
import { diagnoseStorageVisibility, extractPlexMusicSection, resolveConnectionTestConfig, testDownloadPathConfig } from './connection-test'
import { checkCookie } from '../netease'
import { createPlexClient, initPlexClient } from '../plex-client'

export type ConnectionTestSection = 'netease' | 'plex' | 'download'
export interface ConnectionTestResult { section: ConnectionTestSection; message: string; data: Record<string, unknown> }

export function assertConnectionTestSection(value: unknown): ConnectionTestSection {
  if (value === 'netease' || value === 'plex' || value === 'download') return value
  throw new Error('未知的连接测试项')
}

export async function runConnectionTest(section: ConnectionTestSection, candidate?: unknown): Promise<ConnectionTestResult> {
  const config = resolveConnectionTestConfig(candidate)
  if (section === 'netease') return testNetease(config)
  if (section === 'plex') return testPlex(config)
  return testDownload(config)
}

async function testNetease(config: AppConfig): Promise<ConnectionTestResult> {
  if (!config.netease.cookie) throw new Error('未配置网易云 Cookie')
  const result = await checkCookie(config.netease.cookie)
  if (!result.valid) throw new Error('网易云 Cookie 已失效，请重新获取')
  const nickname = result.profile?.nickname ?? '未知用户'
  return { section: 'netease', message: `网易云音乐连接正常 (${nickname})`, data: { section: 'netease', success: true, nickname, userId: result.profile?.userId ?? null } }
}

async function testPlex(config: AppConfig): Promise<ConnectionTestResult> {
  if (!config.plex.server || !config.plex.token) throw new Error('未配置 Plex 服务器地址或 Token')
  const machineId = await initPlexClient(config.plex)
  const inspection = await inspectPlexSection(config)
  const storageVisibility = diagnoseStorageVisibility(config, inspection)
  return {
    section: 'plex',
    message: storageVisibility.status === 'warning' ? `Plex 连接正常，但文件发布链路需要确认：${storageVisibility.summary}` : `Plex 连接正常 (ID: ${machineId})`,
    data: { section: 'plex', success: true, machineId, plexSection: inspection.section ?? null, storageVisibility },
  }
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
