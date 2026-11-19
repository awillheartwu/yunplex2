import { constants, accessSync, realpathSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import { join, relative, sep } from 'node:path'
import type {
  AppConfig,
  PlexMusicSectionInfo,
  StorageVisibilityCheck,
  StorageVisibilityCode,
  StorageVisibilityDiagnostic,
} from './types'
import { readConfig } from './store'
import { mergeAndValidateConfig } from './validation'
import {
  mapLocalPathToPlex,
  mapPlexPathToLocal,
  normalizePathPrefix,
} from '../sync/path-map'
import { ConnectionTestError } from './connection-test-error'
import { sanitizeDiagnosticMessage } from '../domain-error'

export const PATH_MAPPING_DISCLOSURE = '路径设置不会传输文件。'
export const DOWNLOAD_WRITE_PROBE_PREFIX = '.yunplex-write-probe-'
const DIAGNOSTIC_RELATIVE_PATH = join('艺人', '专辑', '歌曲.flac')

export function resolveConnectionTestConfig(candidate?: unknown): AppConfig {
  return candidate ? mergeAndValidateConfig(readConfig(), candidate) : readConfig()
}

export interface DownloadPathTestResult {
  section: 'download'
  success: true
  writable: boolean
  downloadDir: string
  mappedPrefix?: string
  storageVisibility: StorageVisibilityDiagnostic
}

export interface StorageVisibilityOptions {
  section?: PlexMusicSectionInfo | null
  plexInspectionError?: string
  /** Allows deterministic tests; production defaults to this process' network addresses. */
  localAddresses?: string[]
}

export function testDownloadPathConfig(
  config: AppConfig,
  options: StorageVisibilityOptions = {},
): DownloadPathTestResult {
  const downloadDir = normalizePathPrefix(config.download.dir)
  if (!downloadDir) throw new ConnectionTestError('validation_failed', '未配置下载目录')

  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(downloadDir)
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? ''
    if (reason === 'ENOENT') {
      throw new ConnectionTestError('validation_failed', `下载目录不存在: ${downloadDir}。请填写应用能访问的路径；Docker 部署时，NAS 目录需要先挂进容器。`)
    }
    if (reason === 'EACCES' || reason === 'EPERM') {
      throw new ConnectionTestError('validation_failed', `下载目录无法访问: ${downloadDir}（应用运行身份权限不足）`)
    }
    throw new ConnectionTestError('validation_failed', `下载目录不可访问: ${downloadDir}`)
  }
  if (!stat.isDirectory()) throw new ConnectionTestError('validation_failed', `下载目录不是有效文件夹: ${downloadDir}`)

  try {
    accessSync(downloadDir, constants.W_OK)
  } catch {
    throw new ConnectionTestError('filesystem_failed', `下载目录不可写: ${downloadDir}。请检查目录的写权限，以及 Docker 挂载是否为只读。`)
  }

  assertDownloadDirWritable(downloadDir)

  const plexPrefix = normalizePathPrefix(config.download.plexLibraryPathPrefix)
  return {
    section: 'download',
    success: true,
    writable: true,
    downloadDir,
    ...(plexPrefix ? { mappedPrefix: `${plexPrefix}/... -> ${downloadDir}/...` } : {}),
    storageVisibility: diagnoseStorageVisibility(config, options),
  }
}

/**
 * Proves the directory can actually take a new file and is not out of space, instead of trusting
 * permission bits alone. The unique probe file is always removed in `finally`.
 */
export function assertDownloadDirWritable(downloadDir: string): void {
  if (readAvailableBlocks(downloadDir) === 0) {
    throw new ConnectionTestError('filesystem_failed', `下载目录所在存储已无可用空间: ${downloadDir}`)
  }

  const probePath = join(downloadDir, `${DOWNLOAD_WRITE_PROBE_PREFIX}${randomUUID()}.tmp`)
  try {
    writeFileSync(probePath, 'yunplex-write-probe', { flag: 'wx' })
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? ''
    if (reason === 'ENOSPC') throw new ConnectionTestError('filesystem_failed', `下载目录所在存储已无可用空间: ${downloadDir}`)
    if (reason === 'EACCES' || reason === 'EPERM' || reason === 'EROFS') throw new ConnectionTestError('filesystem_failed', `下载目录不可写: ${downloadDir}。应用缺少写权限，或该位置为只读。`)
    throw new ConnectionTestError('filesystem_failed', `下载目录写入测试失败: ${downloadDir}`)
  } finally {
    try {
      rmSync(probePath, { force: true })
    } catch { /* nothing left to clean up when the probe never landed or the mount vanished */ }
  }
}

function readAvailableBlocks(path: string): number | null {
  try {
    const blocks = Number(statfsSync(path).bavail)
    return Number.isFinite(blocks) ? blocks : null
  } catch {
    return null
  }
}

export function diagnoseStorageVisibility(
  config: AppConfig,
  options: StorageVisibilityOptions = {},
): StorageVisibilityDiagnostic {
  const downloadDir = normalizePathPrefix(config.download.dir)
  const plexPathPrefix = normalizePathPrefix(config.download.plexLibraryPathPrefix) || null
  const plexInspectionError = sanitizeDiagnosticMessage(options.plexInspectionError)
  const section = options.section ?? null
  const sectionLocations = section?.locations.map(normalizePathPrefix).filter(Boolean) ?? []
  const serverScope = getServerScope(config.plex.server, options.localAddresses)
  const localPath = normalizePathPrefix(join(downloadDir, DIAGNOSTIC_RELATIVE_PATH))
  const plexPath = mapLocalPathToPlex(localPath, config)
  const roundTripLocalPath = plexPath ? mapPlexPathToLocal(plexPath, config) : null
  const mappingValid = Boolean(plexPath && roundTripLocalPath === localPath)
  const prefixMatchesSection = sectionLocations.length === 0
    ? null
    : sectionLocations.some(location => isSamePathOrInside(location, plexPathPrefix || downloadDir))
  const localStorageAliasVerified = Boolean(
    plexPathPrefix
    && serverScope === 'local'
    && sectionLocations.some(location => isSamePathOrInside(location, plexPathPrefix))
    && pathsReferenceSameDirectory(downloadDir, plexPathPrefix),
  )

  let code: StorageVisibilityCode
  let summary: string
  let action: string
  let publicationVerified = false

  if (plexInspectionError) {
    code = 'plex_inspection_unavailable'
    summary = '无法读取 Plex 音乐库目录。'
    action = '检查 Plex 连接和音乐库名称后重试。'
  } else if (!section || sectionLocations.length === 0) {
    code = 'section_location_unavailable'
    summary = 'Plex 音乐库尚未设置音乐目录。'
    action = '在 Plex 中为此音乐库添加音乐目录后重试。'
  } else if (!mappingValid) {
    code = 'path_mapping_invalid'
    summary = '下载目录与 Plex 对应目录无法正确换算。'
    action = '检查两个目录，确保同一首歌在两端的相对路径一致。'
  } else if (prefixMatchesSection === false) {
    code = plexPathPrefix ? 'section_prefix_mismatch' : 'missing_path_prefix'
    summary = 'Plex 对应目录不在所选音乐库中。'
    action = `将「Plex 对应目录」设为下载目录在 Plex 中的位置，须位于 ${sectionLocations.join('、')} 内。`
  } else if (localStorageAliasVerified || (!plexPathPrefix && serverScope === 'local'
    && sectionLocations.some(location => pathIsVisibleUnderLocalSection(downloadDir, location)))) {
    code = 'shared_storage_verified'
    summary = 'YunPlex 与 Plex 使用同一音乐目录。'
    action = '下载完成后，由 Plex 扫描收录歌曲。'
    publicationVerified = true
  } else if (serverScope === 'remote') {
    code = 'remote_storage_unverified'
    summary = 'Plex 对应目录位于所选音乐库中。'
    action = `两端应挂载同一份音乐目录。${PATH_MAPPING_DISCLOSURE}`
  } else {
    code = 'mapping_only_unverified'
    summary = 'Plex 对应目录位于所选音乐库中。'
    action = `两端应挂载同一份音乐目录。${PATH_MAPPING_DISCLOSURE}`
  }

  const checks: StorageVisibilityCheck[] = [
    {
      key: 'mapping',
      label: '路径对应',
      status: mappingValid ? 'pass' : 'warning',
      detail: mappingValid
        ? '歌曲在两个目录中的相对路径一致。'
        : '请检查下载目录与 Plex 对应目录。',
    },
    {
      key: 'section',
      label: '音乐库目录',
      status: prefixMatchesSection === true ? 'pass' : 'warning',
      detail: prefixMatchesSection === true
        ? 'Plex 对应目录位于此音乐库中。'
        : plexInspectionError || 'Plex 对应目录须位于音乐库的扫描目录中。',
    },
  ]

  return {
    status: publicationVerified ? 'verified' : (code === 'remote_storage_unverified' || code === 'mapping_only_unverified') ? 'configured' : 'warning',
    code,
    summary,
    action,
    publicationVerified,
    mappingValid,
    serverScope,
    downloadDir,
    plexPathPrefix,
    sectionName: config.plex.section,
    sectionKey: section?.key ?? null,
    sectionLocations,
    prefixMatchesSection,
    ...(plexInspectionError ? { inspectionError: plexInspectionError } : {}),
    sample: {
      relativePath: DIAGNOSTIC_RELATIVE_PATH,
      localPath,
      plexPath,
      roundTripLocalPath,
      roundTripMatches: mappingValid,
    },
    checks,
  }
}

export function extractPlexMusicSection(payload: unknown, sectionName: string): PlexMusicSectionInfo | null {
  const root = asRecord(payload)
  const container = asRecord(root?.MediaContainer)
  const directories = asArray(container?.Directory)
  for (const value of directories) {
    const directory = asRecord(value)
    if (!directory || directory.type !== 'artist' || directory.title !== sectionName) continue
    const key = stringValue(directory.key)
    const title = stringValue(directory.title)
    if (!key || !title) continue
    const locations = [...new Set(asArray(directory.Location)
      .map(location => stringValue(asRecord(location)?.path))
      .filter((path): path is string => Boolean(path))
      .map(normalizePathPrefix)
      .filter(Boolean))]
    return { key, title, locations }
  }
  return null
}

function getServerScope(server: string, providedAddresses?: string[]): 'local' | 'remote' | 'unknown' {
  const host = parseServerHost(server)
  if (!host) return 'unknown'
  const normalizedHost = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalizedHost === 'localhost' || normalizedHost === '::1' || normalizedHost.startsWith('127.')) return 'local'
  const localAddresses = new Set((providedAddresses ?? currentLocalAddresses()).map(address => address.toLowerCase()))
  localAddresses.add(hostname().toLowerCase())
  return localAddresses.has(normalizedHost) ? 'local' : 'remote'
}

function parseServerHost(server: string): string | null {
  const trimmed = server.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`).hostname || null
  } catch {
    return trimmed.split('/')[0]?.split(':')[0] || null
  }
}

function currentLocalAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) addresses.push(entry.address)
  }
  return addresses
}

function isSamePathOrInside(parent: string, child: string): boolean {
  const normalizedParent = normalizePathPrefix(parent)
  const normalizedChild = normalizePathPrefix(child)
  if (!normalizedParent || !normalizedChild) return false
  return normalizedParent === normalizedChild || isPathInside(normalizedParent, normalizedChild)
}

function isPathInside(parent: string, child: string): boolean {
  const suffix = relative(parent, child)
  return Boolean(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`)
}

function pathsReferenceSameDirectory(left: string, right: string): boolean {
  const a = normalizePathPrefix(left)
  const b = normalizePathPrefix(right)
  if (!a || !b) return false
  try {
    const aReal = realpathSync(a)
    const bReal = realpathSync(b)
    if (aReal === bReal) return true
    const aStat = statSync(aReal)
    const bStat = statSync(bReal)
    return aStat.dev === bStat.dev && aStat.ino === bStat.ino
  } catch {
    return false
  }
}

function pathIsVisibleUnderLocalSection(downloadDir: string, sectionLocation: string): boolean {
  try {
    const downloadRealPath = realpathSync(downloadDir)
    const sectionRealPath = realpathSync(sectionLocation)
    return downloadRealPath === sectionRealPath || isPathInside(sectionRealPath, downloadRealPath)
  } catch {
    return false
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value === null || value === undefined ? [] : [value]
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return null
}
