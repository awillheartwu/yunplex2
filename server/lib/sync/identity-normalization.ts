import { posix } from 'node:path'

export function normalizePlexPath(path: string): string {
  const slashed = path.trim().normalize('NFC').replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (!slashed) return ''
  const normalized = posix.normalize(slashed).normalize('NFC')
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}

/**
 * Case-folded search key. Persisted identity uses exact normalized paths.
 */
export function foldPlexPath(path: string): string {
  return normalizePlexPath(path).toLocaleLowerCase('en-US')
}

export function plexPathsExactlyEqual(first: string, second: string): boolean {
  return normalizePlexPath(first) === normalizePlexPath(second)
}

export function normalizePlexRelativePath(path: string, sectionRoot?: string | null): string {
  const normalizedPath = normalizePlexPath(path)
  if (!normalizedPath || normalizedPath === '.') return ''

  const normalizedRoot = sectionRoot ? normalizePlexPath(sectionRoot) : ''
  if (normalizedRoot && normalizedPath === normalizedRoot) return ''
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }

  // Strip the section root even when the stored path has no leading slash.
  const rootWithoutLeadingSlash = normalizedRoot.replace(/^\/+/, '')
  const pathWithoutLeadingSlash = normalizedPath.replace(/^\/+/, '')
  if (rootWithoutLeadingSlash && pathWithoutLeadingSlash === rootWithoutLeadingSlash) return ''
  if (rootWithoutLeadingSlash && pathWithoutLeadingSlash.startsWith(`${rootWithoutLeadingSlash}/`)) {
    return pathWithoutLeadingSlash.slice(rootWithoutLeadingSlash.length + 1)
  }

  return normalizedPath.replace(/^\.\//, '').replace(/^\/+/, '')
}

/** Rehydrate a durable section-relative identity under the current Plex root. */
export function resolvePlexIdentityPath(input: {
  relativePath?: string | null
  currentSectionRoot?: string | null
  lastObservedPath?: string | null
}): string {
  const sectionRoot = normalizePlexPath(input.currentSectionRoot ?? '')
  const relativePath = normalizePlexRelativePath(input.relativePath ?? '', sectionRoot)
  if (relativePath && sectionRoot) return normalizePlexPath(`${sectionRoot}/${relativePath}`)
  if (input.lastObservedPath) return normalizePlexPath(input.lastObservedPath)
  return relativePath
}
