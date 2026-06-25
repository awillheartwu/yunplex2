import type { PlaylistSource } from '~~/server/lib/playlist/types'

export function getSourceDisplayName(source: Pick<PlaylistSource, 'name'>): string {
  return source.name || '(待获取)'
}

export function getSourceOriginName(source: Pick<PlaylistSource, 'neteasePlaylistName'>): string {
  return source.neteasePlaylistName || '未命名来源'
}

export function getPlexTargetName(source: Pick<PlaylistSource, 'plexPlaylistName' | 'neteasePlaylistName'>): string {
  return source.plexPlaylistName || source.neteasePlaylistName || '自动匹配'
}

export function getSourceMetaLabel(source: Pick<PlaylistSource, 'name' | 'neteasePlaylistName' | 'neteasePlaylistId'>): string {
  const parts: string[] = []
  if (source.neteasePlaylistName && source.neteasePlaylistName !== source.name) {
    parts.push(source.neteasePlaylistName)
  }
  parts.push(`ID ${source.neteasePlaylistId}`)
  return parts.join(' · ')
}

export function getPlexTargetHint(source: Pick<PlaylistSource, 'plexPlaylistName'>): string {
  return source.plexPlaylistName ? '指定目标' : '按名称匹配'
}

export function getCopyrightCount(source: Pick<PlaylistSource, 'copyrightRestrictedIds'>): number {
  if (!source.copyrightRestrictedIds) return 0
  try {
    const parsed = JSON.parse(source.copyrightRestrictedIds)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

export function getIgnoredFailureCount(source: Pick<PlaylistSource, 'ignoredFailureIds'>): number {
  if (!source.ignoredFailureIds) return 0
  try {
    const parsed = JSON.parse(source.ignoredFailureIds)
    return parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0
  } catch {
    return 0
  }
}

export function getIssueCount(source: Pick<PlaylistSource, 'copyrightRestrictedIds' | 'ignoredFailureIds'>): number {
  return getCopyrightCount(source) + getIgnoredFailureCount(source)
}

export function getIssueSummaryLabel(source: Pick<PlaylistSource, 'copyrightRestrictedIds' | 'ignoredFailureIds'>): string {
  const ignored = getIgnoredFailureCount(source)
  const copyright = getCopyrightCount(source)

  if (ignored === 0 && copyright === 0) return '无'
  if (ignored > 0 && copyright > 0) return `忽略 ${ignored} · 版权 ${copyright}`
  if (ignored > 0) return `忽略 ${ignored}`
  return `版权 ${copyright}`
}

export function getSourceStateLabel(source: Pick<PlaylistSource, 'type' | 'enabled'>): string {
  if (source.type === 'album') return '专辑'
  return source.enabled ? '已启用' : '已禁用'
}

export function getSourceStateTone(source: Pick<PlaylistSource, 'type' | 'enabled'>): 'neutral' | 'success' | 'warning' {
  if (source.type === 'album') return 'warning'
  return source.enabled ? 'success' : 'neutral'
}

export function getSyncResultLabel(source: Pick<PlaylistSource, 'type' | 'lastSyncedAt' | 'lastStatus'>): string {
  const idleLabel = source.type === 'album' ? '未下载' : '未同步'
  if (!source.lastSyncedAt) return idleLabel
  switch (source.lastStatus) {
    case 'success':
      return source.type === 'album' ? '下载成功' : '同步成功'
    case 'partial':
      return source.type === 'album' ? '部分下载失败' : '部分失败'
    case 'failed':
      return source.type === 'album' ? '下载失败' : '同步失败'
    default:
      return '空闲'
  }
}

export function getSyncResultTone(source: Pick<PlaylistSource, 'lastSyncedAt' | 'lastStatus'>): 'neutral' | 'success' | 'warning' | 'danger' {
  if (!source.lastSyncedAt) return 'neutral'
  switch (source.lastStatus) {
    case 'success':
      return 'success'
    case 'partial':
      return 'warning'
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function formatSyncSourceRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}
