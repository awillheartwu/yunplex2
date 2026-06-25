import type { ActivityActor, ActivityDomain, ActivityEvent, ActivitySeverity } from '~~/server/lib/activity/types'
import type { DashboardActivityItem, DashboardTone } from '~~/types/dashboard'

type ActivityLike = Pick<ActivityEvent, 'domain' | 'type' | 'severity'> & Partial<Pick<ActivityEvent, 'actor'>>

export const DASHBOARD_ACTIVITY_PREVIEW_ROUTE = '/activity'

const HEADLINE_PRIORITY_RULES: Array<{ when: (event: ActivityLike) => boolean; score: number }> = [
  { when: event => event.severity === 'error', score: 600 },
  { when: event => event.severity === 'warning', score: 520 },
  { when: event => event.type.startsWith('sync_run_'), score: 460 },
  { when: event => event.domain === 'user', score: 440 },
  { when: event => event.type.startsWith('source_sync_') && event.type !== 'source_sync_skipped_unchanged', score: 420 },
  { when: event => event.type.startsWith('repair_'), score: 360 },
  { when: event => event.type.startsWith('download_'), score: 340 },
  { when: event => event.type === 'source_sync_skipped_unchanged', score: 260 },
  { when: event => event.type === 'plex_playlist_reordered', score: 180 },
  { when: event => event.type === 'plex_library_refresh_requested', score: 120 },
]

export function activityHeadlinePriority(event: ActivityLike): number {
  const matched = HEADLINE_PRIORITY_RULES.find(rule => rule.when(event))
  if (matched) return matched.score

  if (event.severity === 'success') return 220
  if (event.domain === 'plex') return 160
  return 140
}

export function activityTone(event: ActivityLike): DashboardTone {
  switch (event.severity) {
    case 'error':
      return 'danger'
    case 'warning':
      return 'warning'
    case 'success':
      return event.domain === 'download' ? 'accent' : 'success'
    default:
      return event.domain === 'user' || event.domain === 'plex' ? 'accent' : 'neutral'
  }
}

export function activityIcon(event: ActivityLike): string {
  if (event.domain === 'user') {
    if (event.type.includes('config')) return 'settings'
    if (event.type.includes('delete')) return 'trash'
    if (event.type.includes('edit') || event.type.includes('update')) return 'edit'
    if (event.type.includes('reorder')) return 'list'
    return 'source'
  }

  if (event.domain === 'download') return event.severity === 'error' ? 'alert' : 'download'
  if (event.domain === 'plex') return event.type.includes('reorder') ? 'list' : 'music'
  if (event.type.includes('repair')) return 'repair'
  return 'sync'
}

export function activitySeverityLabel(severity: ActivitySeverity): string {
  switch (severity) {
    case 'error':
      return '失败'
    case 'warning':
      return '关注'
    case 'success':
      return '完成'
    default:
      return '记录'
  }
}

export function activityDomainLabel(domain: ActivityDomain): string {
  switch (domain) {
    case 'sync':
      return '同步'
    case 'download':
      return '下载'
    case 'plex':
      return 'Plex'
    case 'user':
      return '用户操作'
  }
}

export function activitySurfaceLabel(item: Pick<DashboardActivityItem, 'domain' | 'type'>): string {
  if (item.domain === 'download') return '下载记录'
  if (item.domain === 'user') return '任务操作'
  if (item.type.startsWith('sync_run_') || item.type.startsWith('source_sync_') || item.type.startsWith('repair_')) return '运行记录'
  if (item.domain === 'plex') return '执行时间线'
  return '活动事件'
}

export function dashboardActivityPreviewLink(id: string): string {
  return `${DASHBOARD_ACTIVITY_PREVIEW_ROUTE}?event=${encodeURIComponent(id)}`
}

export function activityStatusLabel(
  severity: ActivitySeverity,
  actor?: ActivityActor,
): string | null {
  switch (severity) {
    case 'error':
      return '失败'
    case 'warning':
      return '关注'
    case 'success':
      return '完成'
    default:
      return actor === 'user' ? '操作' : null
  }
}
