import type { PlaylistSource } from '../playlist/types'
import type { SyncState } from '../log/types'
import {
  type DashboardPendingItem,
  type DashboardSourceHealthSummary,
  type DashboardSummary,
  type DashboardTone,
} from '~~/types/dashboard'
import { getSystemHealthSnapshot } from '../system-health'
import { readConfig } from '../config/store'
import { listSources } from '../playlist/store'
import { getQueueStatus } from '../download/queue'
import { getDailyDownloadStats } from '../download/stats'
import { queryFailureRecords } from '../tasks/failure-records'
import { getSyncServiceInstance } from '../sync/instance'

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
    const hasFailures = source.actionableFailureCount > 0
    const hasCopyright = source.copyrightRestrictedCount > 0
    if (!source.lastSyncedAt || source.lastStatus === 'idle') {
      summary.unsynced++
    } else if (source.lastStatus === 'failed') {
      summary.failed++
    } else if (source.lastStatus === 'partial' || hasFailures || hasCopyright) {
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

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const config = readConfig()
  const syncState = resolveSyncState()
  const [health, sources, queueStatus, trendPoints, actionableFailures, copyrightFailures, downloadFailures, todayFailures, yesterdayFailures] = await Promise.all([
    getSystemHealthSnapshot(),
    Promise.resolve(listSources()),
    Promise.resolve(getQueueStatus()),
    Promise.resolve(getDailyDownloadStats(7)),
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
