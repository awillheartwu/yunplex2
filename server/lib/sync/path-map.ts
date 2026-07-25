import { existsSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'
import type { AppConfig } from '../config/types'

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, '')
}

export function normalizePathPrefix(value: string | null | undefined): string {
  if (!value) return ''
  const normalized = normalize(value.trim())
  if (!normalized || normalized === '.') return ''
  return trimTrailingSeparators(normalized)
}

export function normalizeExistingLocalPath(value: string | null | undefined): string | null {
  const normalized = normalizePathPrefix(value)
  return normalized || null
}

export function mapPlexPathToLocal(plexPath: string | null | undefined, cfg: AppConfig): string | null {
  if (!plexPath) return null

  const plexPrefix = normalizePathPrefix(cfg.download.plexLibraryPathPrefix)
  const downloadDir = normalizePathPrefix(cfg.download.dir)
  const normalizedPath = normalize(plexPath)

  if (!downloadDir) return null
  if (!plexPrefix) return normalizeExistingLocalPath(normalizedPath)

  if (normalizedPath === plexPrefix) return downloadDir
  if (!normalizedPath.startsWith(plexPrefix + sep)) return null

  const suffix = relative(plexPrefix, normalizedPath)
  return suffix ? join(downloadDir, suffix) : downloadDir
}

/** Map an application-visible media path to the path exposed to Plex. */
export function mapLocalPathToPlex(localPath: string | null | undefined, cfg: AppConfig): string | null {
  const normalizedPath = normalizeExistingLocalPath(localPath)
  const downloadDir = normalizePathPrefix(cfg.download.dir)
  const plexPrefix = normalizePathPrefix(cfg.download.plexLibraryPathPrefix)

  if (!normalizedPath || !downloadDir) return null
  if (!plexPrefix) return normalizedPath
  if (normalizedPath === downloadDir) return plexPrefix

  const suffix = relative(downloadDir, normalizedPath)
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) return null
  return normalize(join(plexPrefix, suffix))
}

export function resolveAccessibleLocalPath(pathLike: string | null | undefined, cfg: AppConfig): string | null {
  const direct = normalizeExistingLocalPath(pathLike)
  if (direct && existsSync(direct)) return direct

  const mapped = mapPlexPathToLocal(pathLike, cfg)
  if (mapped && existsSync(mapped)) return mapped

  return null
}
