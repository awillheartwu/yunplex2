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

export const PATH_MAPPING_DISCLOSURE = '路径映射只负责换算文件名，不会上传、复制或同步任何文件到 Plex 服务器。'
export const DOWNLOAD_WRITE_PROBE_PREFIX = '.yunplex-write-probe-'
const DIAGNOSTIC_RELATIVE_PATH = join('路径诊断', '示例专辑', '01 - 示例歌曲.flac')

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
function assertDownloadDirWritable(downloadDir: string): void {
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
  const prefixMatchesSection = sectionLocations.length === 0 || !plexPathPrefix
    ? null
    : sectionLocations.some(location => isSamePathOrInside(location, plexPathPrefix))
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
    summary = `无法读取 Plex 音乐库位置，因此尚未验证文件发布链路。${PATH_MAPPING_DISCLOSURE}`
    action = '先确认 Plex 连接与音乐库名称，再重新测试；同时确认下载目录是 Plex 实际扫描目录的共享挂载。'
  } else if (!section || sectionLocations.length === 0) {
    code = 'section_location_unavailable'
    summary = `没有取得 Plex 音乐库的实际位置，因此尚未验证文件发布链路。${PATH_MAPPING_DISCLOSURE}`
    action = '配置并测试 Plex 连接，确认音乐库名称正确且该音乐库至少有一个 Location。'
  } else if (!mappingValid) {
    code = 'path_mapping_invalid'
    summary = `本地路径与 Plex 路径无法完成双向换算。${PATH_MAPPING_DISCLOSURE}`
    action = '修正下载目录和 Plex 音乐库路径前缀，使同一个相对文件在两端映射后保持一致。'
  } else if (!plexPathPrefix) {
    const sameVisiblePath = serverScope === 'local'
      && sectionLocations.some(location => pathIsVisibleUnderLocalSection(downloadDir, location))
    if (sameVisiblePath) {
      code = 'shared_storage_verified'
      summary = '应用与本机 Plex 使用同一个可访问目录，路径发布链路已通过配置与文件系统验证。'
      action = '无需调整；下载完成后仍需等待 Plex 扫描并建立媒体索引。'
      publicationVerified = true
    } else {
      code = 'missing_path_prefix'
      summary = `下载目录与 Plex 音乐库位置不同，且未配置路径前缀。${PATH_MAPPING_DISCLOSURE}`
      action = `将 Plex 路径前缀设为音乐库位置（例如 ${sectionLocations[0]}），并确保下载目录通过 SMB/NFS/容器挂载或外部发布流程写入同一份文件。`
    }
  } else if (prefixMatchesSection === false) {
    code = 'section_prefix_mismatch'
    summary = `配置的 Plex 路径前缀不属于所选音乐库的 Location。${PATH_MAPPING_DISCLOSURE}`
    action = `将 Plex 路径前缀改为与 ${sectionLocations.join('、')} 重叠的根路径，并确认下载目录对应同一份存储。`
  } else if (localStorageAliasVerified) {
    code = 'shared_storage_verified'
    summary = '应用与本机 Plex 的路径指向同一个可访问目录，文件发布链路已验证。'
    action = '无需调整；下载完成后仍需等待 Plex 扫描并建立媒体索引。'
    publicationVerified = true
  } else if (serverScope === 'remote') {
    code = 'remote_storage_unverified'
    summary = `Plex 位于另一主机；当前只完成了路径换算，尚未证明本地下载文件已发布到远端音乐库。${PATH_MAPPING_DISCLOSURE}`
    action = '把下载目录直接挂载到 Plex 扫描的同一份 SMB/NFS/容器卷，或配置独立且可审计的复制/发布流程，然后重新测试。'
  } else {
    code = 'mapping_only_unverified'
    summary = `路径样例可以换算，但无法证明应用与 Plex 看到的是同一份物理文件。${PATH_MAPPING_DISCLOSURE}`
    action = '确认下载目录与 Plex Location 是同一共享卷或同一容器挂载；若依赖外部复制，请先确认复制完成再触发 Plex 扫描。'
  }

  const checks: StorageVisibilityCheck[] = [
    {
      key: 'mapping',
      label: '路径换算',
      status: mappingValid ? 'pass' : 'warning',
      detail: mappingValid
        ? `样例可双向换算：${localPath} ↔ ${plexPath}`
        : '样例路径无法双向换算，请检查两个根路径。',
    },
    {
      key: 'section',
      label: '音乐库位置',
      status: section && sectionLocations.length > 0 && prefixMatchesSection !== false ? 'pass' : 'warning',
      detail: sectionLocations.length > 0
        ? `Plex「${section?.title ?? config.plex.section}」Location：${sectionLocations.join('、')}`
        : plexInspectionError || '未读取到 Plex 音乐库 Location。',
    },
    {
      key: 'publication',
      label: '文件发布',
      status: publicationVerified ? 'pass' : 'warning',
      detail: publicationVerified
        ? '配置与本机文件系统表明两端使用同一个目录。'
        : '未验证下载结果会出现在 Plex 扫描主机；路径映射本身不会传输文件。',
    },
  ]

  return {
    status: publicationVerified ? 'verified' : 'warning',
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
