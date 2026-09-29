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

export function getSyncSourceCoverUrl(url: string, size = 80): string {
  if (!url) return ''
  const [address, fragment] = url.split('#', 2)
  const [path, query = ''] = address!.split('?', 2)
  const params = new URLSearchParams(query)
  params.set('param', `${size}y${size}`)
  return `${path}?${params}${fragment === undefined ? '' : `#${fragment}`}`
}

export function getCopyrightCount(source: Pick<PlaylistSource, 'copyrightRestrictedCount'>): number {
  return source.copyrightRestrictedCount
}

export function getActionableFailureCount(source: Pick<PlaylistSource, 'actionableFailureCount'>): number {
  return source.actionableFailureCount
}

export function getIssueCount(source: Pick<PlaylistSource, 'copyrightRestrictedCount' | 'actionableFailureCount'>): number {
  return getCopyrightCount(source) + getActionableFailureCount(source)
}

export function getIssueSummaryLabel(source: Pick<PlaylistSource, 'copyrightRestrictedCount' | 'actionableFailureCount'>): string {
  const parts: string[] = []
  if (getActionableFailureCount(source) > 0) parts.push(`待处理 ${getActionableFailureCount(source)}`)
  if (getCopyrightCount(source) > 0) parts.push(`版权受限 ${getCopyrightCount(source)}`)
  return parts.join(' · ') || '无待处理异常'
}

export function getIssueActionLabel(source: Pick<PlaylistSource, 'copyrightRestrictedCount' | 'actionableFailureCount'>): string {
  const count = getIssueCount(source)
  return count > 0 ? `重新尝试 ${count} 个来源异常` : '当前没有待处理异常'
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
