import type { PlaylistSource } from '../playlist/types'
import type { SyncState } from '../log/types'
import type { DownloadTask } from '../download/queue'
import type { TaskRunSummary } from '../job/types'
import type { ActivityEvent } from '../activity/types'
import {
  type DashboardActivityItem,
  type DashboardPendingItem,
  type DashboardSourceHealthSummary,
  type DashboardSummary,
  type DashboardTone,
} from '~~/types/dashboard'
import {
  activityHeadlinePriority,
  activityIcon,
  activityStatusLabel,
  activityTone,
} from '~~/lib/activity-presentation'
import { getSystemHealthSnapshot } from '../system-health'
import { readConfig } from '../config/store'
import { listSources } from '../playlist/store'
import { getQueueStatus, listDownloadTasks } from '../download/queue'
import { getDailyDownloadStats } from '../download/stats'
import { queryFailureRecords } from '../tasks/failure-records'
import { listRuns } from '../run/store'
import { getSyncServiceInstance } from '../sync/instance'
import { listActivityEvents } from '../activity/store'

function startOfDay(daysAgo = 0): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function endOfDay(daysAgo = 0): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

function formatSignedDelta(delta: number): string {
  if (delta === 0) return '较昨日 持平'
  return `较昨日 ${delta > 0 ? '+' : ''}${delta}`
}

function hasSerializedIds(value: string | null | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed || trimmed === '[]') return false
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed)
  } catch {
    return true
  }
}

function resolveSyncState(): SyncState {
  try {
    return getSyncServiceInstance().getState()
  } catch {
    return {
      isRunning: false,
      currentStage: 'idle',
      startedAt: null,
      currentSourceName: null,
      lastSyncAt: null,
      lastSyncResult: null,
      syncCount: 0,
      successCount: 0,
      failureCount: 0,
      currentSong: null,
      progress: null,
      failures: [],
      dryRun: false,
    }
  }
}

export function buildSourceHealthSummary(sources: PlaylistSource[]): DashboardSourceHealthSummary {
  const summary: DashboardSourceHealthSummary = {
    total: sources.length,
    normal: 0,
    warning: 0,
    failed: 0,
    unsynced: 0,
  }

  for (const source of sources) {
    const hasIgnored = hasSerializedIds(source.ignoredFailureIds)
    const hasCopyright = hasSerializedIds(source.copyrightRestrictedIds)
    if (!source.lastSyncedAt || source.lastStatus === 'idle') {
      summary.unsynced++
    } else if (source.lastStatus === 'failed') {
      summary.failed++
    } else if (source.lastStatus === 'partial' || hasIgnored || hasCopyright) {
      summary.warning++
    } else {
      summary.normal++
    }
  }

  return summary
}

export function buildPendingItems(input: {
  copyrightCount: number
  failedDownloadCount: number
  failedSourceCount: number
}): DashboardPendingItem[] {
  const items: DashboardPendingItem[] = []

  if (input.copyrightCount > 0) {
    items.push({
      id: 'copyright',
      title: '版权受限歌曲',
      subtitle: `${input.copyrightCount} 首歌曲因版权限制无法下载`,
      count: input.copyrightCount,
      icon: 'warn',
      tone: 'warning',
      link: '/task-center?tab=failures&failureKind=copyright_restricted',
    })
  }

  if (input.failedSourceCount > 0) {
    items.push({
      id: 'sync-failed',
      title: '同步失败的歌单',
      subtitle: `${input.failedSourceCount} 个歌单同步失败`,
      count: input.failedSourceCount,
      icon: 'source',
      tone: 'danger',
      link: '/sync-sources?status=failed',
    })
  }

  if (input.failedDownloadCount > 0) {
    items.push({
      id: 'download-failed',
      title: '下载失败项目',
      subtitle: `${input.failedDownloadCount} 个失败项目等待重新处理`,
      count: input.failedDownloadCount,
      icon: 'download',
      tone: 'accent',
      link: '/task-center?tab=failures&failureKind=failed_download',
    })
  }

  return items.sort((left, right) => right.count - left.count)
}

export function buildRecentActivities(input: {
  events: ActivityEvent[]
  runs: TaskRunSummary[]
  downloads: DownloadTask[]
  sources: PlaylistSource[]
}): DashboardActivityItem[] {
  const activityEvents = buildDashboardActivitiesFromEvents(input.events, 4)
  if (activityEvents.length > 0) return activityEvents
  return buildLegacyRecentActivities(input)
}

function buildLegacyRecentActivities(input: {
  runs: TaskRunSummary[]
  downloads: DownloadTask[]
  sources: PlaylistSource[]
}): DashboardActivityItem[] {
  const sourceMap = new Map(input.sources.map((source) => [source.id, source]))
  const activities: DashboardActivityItem[] = []

  for (const job of input.runs) {
    const sourceName = job.source ? sourceMap.get(job.source)?.name || sourceMap.get(job.source)?.neteasePlaylistName : null
    const isRepair = job.type === 'repair'
    const title = isRepair
      ? job.status === 'success'
        ? '修复元数据'
        : '修复任务未完成'
      : `${sourceName ? `同步源 “${sourceName}”` : '同步任务'} ${job.status === 'success' ? '同步成功' : job.status === 'partial' ? '部分完成' : job.status === 'failed' ? '同步失败' : '已结束'}`
    const subtitle = isRepair
      ? `${job.successSongs} 首已修复，${job.failedSongs} 首未完成`
      : `同步了 ${job.totalSongs} 首歌曲`
    activities.push({
      id: `job:${job.id}`,
      type: job.type,
      domain: 'sync',
      severity: job.status === 'success' ? 'success' : job.status === 'partial' ? 'warning' : job.status === 'failed' ? 'error' : 'info',
      title,
      subtitle,
      timestamp: job.finishedAt || job.startedAt,
      icon: isRepair ? 'repair' : 'sync',
      tone: job.status === 'success' ? 'success' : job.status === 'partial' ? 'warning' : job.status === 'failed' ? 'danger' : 'neutral',
      link: `/task-center/runs/${job.id}`,
      groupKey: `job:${job.id}`,
      statusLabel: job.status === 'success' ? '完成' : job.status === 'partial' ? '部分完成' : job.status === 'failed' ? '失败' : '已结束',
    })
  }

  for (const task of input.downloads) {
    activities.push({
      id: `download:${task.id}`,
      type: task.status === 'failed' ? 'download_failed' : 'download',
      domain: 'download',
      severity: task.status === 'done' ? 'success' : 'error',
      title: `下载任务 “${task.songName}” ${task.status === 'done' ? '已完成' : '失败'}`,
      subtitle: task.status === 'done'
        ? `${task.artist} · ${task.quality || '音频已入库'}`
        : task.error || `${task.artist} · 下载失败`,
      timestamp: task.updatedAt,
      icon: task.status === 'done' ? 'music' : 'alert',
      tone: task.status === 'done' ? 'accent' : 'danger',
      link: '/manual-download?view=history',
      groupKey: task.jobId ? `job:${task.jobId}` : null,
      statusLabel: task.status === 'done' ? '完成' : '失败',
    })
  }

  for (const source of [...input.sources].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 2)) {
    activities.push({
      id: `source:${source.id}`,
      type: 'source_created',
      domain: 'user',
      severity: 'info',
      title: `新增同步源 “${source.name || source.neteasePlaylistName}”`,
      subtitle: source.type === 'album' ? '专辑源已加入控制台' : '歌单源已加入控制台',
      timestamp: source.createdAt,
      icon: 'plus',
      tone: 'neutral',
      link: '/sync-sources',
      groupKey: `source:${source.id}`,
      statusLabel: '新增',
    })
  }

  return activities
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 5)
}

function buildDashboardActivityFromEvent(event: ActivityEvent): DashboardActivityItem {
  return {
    id: event.id,
    type: event.type,
    domain: event.domain,
    severity: event.severity,
    title: event.title,
    subtitle: event.summary,
    timestamp: event.occurredAt,
    icon: activityIcon(event),
    tone: activityTone(event),
    link: event.link || '/task-center?tab=runs',
    groupKey: event.groupKey,
    statusLabel: activityStatusLabel(event.severity, event.actor),
  }
}

export function buildDashboardActivitiesFromEvents(events: ActivityEvent[], maxItems = 5): DashboardActivityItem[] {
  if (events.length === 0) return []

  const winners = new Map<string, ActivityEvent>()
  const standalone: ActivityEvent[] = []

  for (const event of events) {
    if (event.groupKey) {
      const current = winners.get(event.groupKey)
      if (!current) {
        winners.set(event.groupKey, event)
        continue
      }

      const nextScore = activityHeadlinePriority(event)
      const currentScore = activityHeadlinePriority(current)
      if (nextScore > currentScore || (nextScore === currentScore && event.occurredAt > current.occurredAt)) {
        winners.set(event.groupKey, event)
      }
      continue
    }

    standalone.push(event)
  }

  return [...winners.values(), ...standalone]
    .sort((left, right) => {
      const timeDiff = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
      if (Math.abs(timeDiff) > 5 * 60 * 1000) return timeDiff
      return activityHeadlinePriority(right) - activityHeadlinePriority(left) || timeDiff
    })
    .slice(0, maxItems)
    .map(buildDashboardActivityFromEvent)
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const config = readConfig()
  const syncState = resolveSyncState()
  const [health, sources, queueStatus, trendPoints, downloadHistory, runs, activityEvents, actionableFailures, copyrightFailures, downloadFailures, todayFailures, yesterdayFailures] = await Promise.all([
    getSystemHealthSnapshot(),
    Promise.resolve(listSources()),
    Promise.resolve(getQueueStatus()),
    Promise.resolve(getDailyDownloadStats(7)),
    Promise.resolve(listDownloadTasks({ status: 'done,failed', limit: 8, offset: 0 }).items),
    Promise.resolve(listRuns({ limit: 5, offset: 0 }).items),
    Promise.resolve(listActivityEvents({ limit: 40 }).items),
    Promise.resolve(queryFailureRecords({ status: 'open', excludeFailureKinds: ['copyright_restricted'], limit: 1 })),
    Promise.resolve(queryFailureRecords({ status: 'open', failureKind: 'copyright_restricted', limit: 1 })),
    Promise.resolve(queryFailureRecords({ status: 'open', failureKind: 'failed_download', limit: 1 })),
    Promise.resolve(queryFailureRecords({ status: 'open', excludeFailureKinds: ['copyright_restricted'], from: startOfDay(0), to: endOfDay(0), limit: 1 })),
    Promise.resolve(queryFailureRecords({ status: 'open', excludeFailureKinds: ['copyright_restricted'], from: startOfDay(1), to: endOfDay(1), limit: 1 })),
  ])

  const healthSummary = buildSourceHealthSummary(sources)
  const pendingItems = buildPendingItems({
    copyrightCount: copyrightFailures.total,
    failedDownloadCount: downloadFailures.total,
    failedSourceCount: sources.filter((source) => source.lastStatus === 'failed').length,
  })

  const activities = buildRecentActivities({
    events: activityEvents,
    runs,
    downloads: downloadHistory,
    sources,
  })

  const latestTrend = trendPoints.at(-1)?.count ?? 0
  const previousTrend = trendPoints.at(-2)?.count ?? 0
  const createdToday = sources.filter((source) => source.createdAt >= startOfDay(0)).length
  const createdYesterday = sources.filter((source) => source.createdAt >= startOfDay(1) && source.createdAt < startOfDay(0)).length

  const overallTone: DashboardTone = !health.plexOk || !health.neteaseOk || !health.dirWritable || healthSummary.failed > 0
    ? 'danger'
    : pendingItems.length > 0 || healthSummary.warning > 0
      ? 'warning'
      : syncState.isRunning
        ? 'accent'
        : 'success'

  const overallLabel = overallTone === 'danger'
    ? '注意'
    : overallTone === 'warning'
      ? '关注'
      : syncState.isRunning
        ? '进行中'
        : '正常'

  return {
    status: {
      overallTone,
      overallLabel,
      items: [
        { key: 'plex', label: 'Plex 在线', ok: health.plexOk },
        { key: 'netease', label: '网易云已登录', ok: health.neteaseOk },
        { key: 'dir', label: '下载目录正常', ok: health.dirWritable },
      ],
      lastSyncAt: syncState.lastSyncAt,
      autoSyncEnabled: config.sync.enabled,
      syncRunning: syncState.isRunning,
    },
    kpis: [
      {
        key: 'downloads',
        label: '已下载歌曲',
        value: String(queueStatus.done),
        note: formatSignedDelta(latestTrend - previousTrend),
        icon: 'music',
        tone: 'accent',
      },
      {
        key: 'failures',
        label: '失败次数',
        value: String(actionableFailures.total),
        note: formatSignedDelta(todayFailures.total - yesterdayFailures.total),
        icon: 'alert',
        tone: actionableFailures.total > 0 ? 'danger' : 'success',
      },
      {
        key: 'sources',
        label: '同步源数',
        value: String(sources.length),
        note: formatSignedDelta(createdToday - createdYesterday),
        icon: 'source',
        tone: 'accent',
      },
      {
        key: 'last-result',
        label: '最后结果',
        value: syncState.lastSyncResult === 'success' ? '成功' : syncState.lastSyncResult === 'failure' ? '异常' : '未同步',
        note: syncState.lastSyncAt ? `上轮同步 ${formatRelativeTime(syncState.lastSyncAt)}` : '尚未运行同步',
        icon: 'check',
        tone: syncState.lastSyncResult === 'failure' ? 'danger' : syncState.lastSyncResult === 'success' ? 'success' : 'neutral',
      },
    ],
    trend: {
      days: 7,
      points: trendPoints,
    },
    pendingItems,
    recentActivities: activities,
    sourceHealth: healthSummary,
  }
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}
