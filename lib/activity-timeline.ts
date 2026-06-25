import type { ActivityDomain, ActivityEvent } from '~~/server/lib/activity/types'
import type { DashboardActivityItem } from '~~/types/dashboard'
import type { ProcessTimelineAction, ProcessTimelineDetail, ProcessTimelineItem } from '~~/lib/process-timeline'
import type { TaskSemanticTone } from '~~/lib/task-status'
import {
  activityDomainLabel,
  activitySeverityLabel,
  activitySurfaceLabel,
  dashboardActivityPreviewLink,
} from '~~/lib/activity-presentation'
import { formatDashboardRelativeTime } from '~~/composables/useDashboardFormat'

interface ActivityTimelineOptions {
  highlightedId?: string
}

export function buildActivityTimelineItems(
  events: ActivityEvent[],
  options: ActivityTimelineOptions = {},
): ProcessTimelineItem[] {
  const items: ProcessTimelineItem[] = []
  let index = 0

  while (index < events.length) {
    const event = events[index]!
    const key = aggregateActivityKey(event)
    if (!key) {
      items.push(activityEventToTimelineItem(event, options.highlightedId))
      index++
      continue
    }

    const group = [event]
    let next = index + 1
    while (next < events.length && aggregateActivityKey(events[next]!) === key) {
      group.push(events[next]!)
      next++
    }

    if (group.length >= 3) {
      items.push(activityEventGroupToTimelineItem(key, group, options.highlightedId))
    } else {
      items.push(...group.map(item => activityEventToTimelineItem(item, options.highlightedId)))
    }
    index = next
  }

  return items
}

export function activityEventToTimelineItem(event: ActivityEvent, highlightedId = ''): ProcessTimelineItem {
  const domainLabel = activityDomainLabel(event.domain)
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    title: event.title,
    description: event.summary || domainLabel,
    subjectLabel: activitySubjectLabel(event),
    subjectIcon: activitySubjectIcon(event.domain),
    tone: activitySemanticTone(event),
    icon: activityIcon(event),
    statusLabel: activitySeverityLabel(event.severity),
    details: activityDetails(event),
    action: activityAction(event),
    highlighted: event.id === highlightedId,
  }
}

export function dashboardActivityItemToTimelineItem(item: DashboardActivityItem): ProcessTimelineItem {
  return {
    id: item.id,
    occurredAt: item.timestamp,
    timeLabel: formatDashboardRelativeTime(item.timestamp),
    title: item.title,
    description: item.subtitle || activityDomainLabel(item.domain),
    subjectLabel: activitySurfaceLabel(item),
    subjectIcon: dashboardSubjectIcon(item.domain),
    tone: dashboardSemanticTone(item),
    icon: dashboardActivityIcon(item),
    statusLabel: item.statusLabel || nullLabel(item),
    details: [],
    action: {
      label: '查看',
      to: dashboardActivityPreviewLink(item.id),
      icon: 'arrowRight',
      ariaLabel: `查看活动：${item.title}`,
    },
  }
}

function aggregateActivityKey(event: ActivityEvent): string {
  if (event.type === 'source_sync_skipped_unchanged') return 'source_sync_skipped_unchanged'
  if (event.type === 'plex_playlist_reordered') return 'plex_playlist_reordered'
  return ''
}

function activityEventGroupToTimelineItem(key: string, events: ActivityEvent[], highlightedId = ''): ProcessTimelineItem {
  const first = events[0]!
  const sharedLink = sharedAction(events)
  const base = key === 'source_sync_skipped_unchanged'
    ? {
        title: `跳过 ${events.length} 个同步源`,
        description: '检测到内容未变化，已连续跳过这些同步源',
        icon: 'existing',
        tone: 'existing' as TaskSemanticTone,
        subjectLabel: '同步源',
      }
    : {
        title: `Plex 歌单重排 ${events.length} 次`,
        description: '多个 Plex 歌单已按同步源顺序完成重排',
        icon: 'list',
        tone: 'success' as TaskSemanticTone,
        subjectLabel: 'Plex',
      }

  return {
    id: `activity-group:${key}:${first.id}`,
    occurredAt: first.occurredAt,
    title: base.title,
    description: base.description,
    subjectLabel: base.subjectLabel,
    subjectIcon: key === 'plex_playlist_reordered' ? 'music' : 'source',
    tone: base.tone,
    icon: base.icon,
    statusLabel: `${events.length} 项`,
    details: events.map(activityEventToDetail),
    action: sharedLink ? activityAction(sharedLink) : undefined,
    highlighted: events.some(event => event.id === highlightedId),
  }
}

function activityEventToDetail(event: ActivityEvent): ProcessTimelineDetail {
  return {
    id: event.id,
    title: event.title,
    description: event.summary || activityDomainLabel(event.domain),
    subjectLabel: activitySubjectLabel(event),
    tone: activitySemanticTone(event),
  }
}

function sharedAction(events: ActivityEvent[]): ActivityEvent | null {
  const link = events[0]?.link
  if (!link) return null
  return events.every(event => event.link === link) ? events[0]! : null
}

function activitySemanticTone(event: Pick<ActivityEvent, 'severity' | 'type' | 'domain'>): TaskSemanticTone {
  if (event.severity === 'error') return 'failure'
  if (event.severity === 'warning') return 'warning'
  if (event.type.includes('copyright') || event.type.includes('ignored')) return 'ignored'
  if (event.type.includes('skipped') || event.type.includes('unchanged')) return 'existing'
  if (event.severity === 'success') return 'success'
  if (event.domain === 'download') return 'running'
  return 'neutral'
}

function activityIcon(event: Pick<ActivityEvent, 'domain' | 'type' | 'severity'>): string {
  if (event.severity === 'error') return 'failure'
  if (event.type.includes('skipped') || event.type.includes('unchanged')) return 'existing'
  if (event.type.includes('copyright') || event.type.includes('ignored')) return 'ignored'
  if (event.domain === 'download') return event.type.includes('completed') || event.severity === 'success' ? 'download' : 'loader'
  if (event.domain === 'plex') return event.type.includes('reorder') ? 'list' : event.type.includes('refresh') ? 'refresh' : 'music'
  if (event.domain === 'user') {
    if (event.type.includes('config')) return 'settings'
    if (event.type.includes('delete')) return 'trash'
    if (event.type.includes('edit') || event.type.includes('update')) return 'edit'
    if (event.type.includes('reorder')) return 'list'
    return 'user'
  }
  if (event.type.includes('repair')) return 'repair'
  if (event.severity === 'success') return 'checkCircle'
  return 'sync'
}

function activitySubjectIcon(domain: ActivityDomain): string {
  if (domain === 'download') return 'music'
  if (domain === 'plex') return 'music'
  if (domain === 'user') return 'user'
  return 'source'
}

function activitySubjectLabel(event: Pick<ActivityEvent, 'context' | 'domain' | 'type'>): string | undefined {
  const context = event.context
  return stringValue(context.sourceName)
    || stringValue(context.songName)
    || stringValue(context.configKey)
    || activitySurfaceLabel({ domain: event.domain, type: event.type })
}

function activityDetails(event: ActivityEvent): ProcessTimelineDetail[] {
  const details: ProcessTimelineDetail[] = [
    { id: `${event.id}:domain`, title: '领域', description: activityDomainLabel(event.domain), tone: 'neutral' },
    { id: `${event.id}:type`, title: '事件类型', description: event.type, tone: 'neutral' },
    { id: `${event.id}:actor`, title: '触发者', description: event.actor === 'user' ? '用户操作' : '系统自动', tone: 'neutral' },
  ]
  if (event.groupKey) details.push({ id: `${event.id}:group`, title: '分组', description: event.groupKey, tone: 'neutral' })
  if (event.link) details.push({ id: `${event.id}:link`, title: '关联入口', description: activityActionLabel(event.link), tone: activitySemanticTone(event) })
  return details
}

function activityAction(event: Pick<ActivityEvent, 'link' | 'title'>): ProcessTimelineAction | undefined {
  if (!event.link) return undefined
  const label = activityActionLabel(event.link)
  return {
    label,
    to: event.link,
    icon: activityActionIcon(event.link),
    ariaLabel: `${label}：${event.title}`,
  }
}

function activityActionLabel(link: string): string {
  if (link.startsWith('/task-center')) return '查看运行'
  if (link.startsWith('/manual-download')) return '查看下载'
  if (link.startsWith('/sync-sources')) return '查看同步源'
  if (link.startsWith('/config')) return '查看设置'
  return '查看详情'
}

function activityActionIcon(link: string): string {
  if (link.startsWith('/task-center')) return 'activity'
  if (link.startsWith('/manual-download')) return 'download'
  if (link.startsWith('/sync-sources')) return 'source'
  if (link.startsWith('/config')) return 'settings'
  return 'external'
}

function dashboardSemanticTone(item: DashboardActivityItem): TaskSemanticTone {
  return activitySemanticTone({ severity: item.severity, type: item.type, domain: item.domain })
}

function dashboardActivityIcon(item: DashboardActivityItem): string {
  return activityIcon({ domain: item.domain, type: item.type, severity: item.severity })
}

function dashboardSubjectIcon(domain: ActivityDomain): string {
  return activitySubjectIcon(domain)
}

function nullLabel(item: DashboardActivityItem): string | undefined {
  return item.severity === 'info' ? undefined : activitySeverityLabel(item.severity)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}
