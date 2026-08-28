import type { PlaylistSource } from '../playlist/types'
import type { SyncState } from '../log/types'
import {
  type DashboardPendingItem,
  type DashboardDownloadTrendPoint,
  type DashboardSourceHealthSummary,
  type DashboardSummary,
  type DashboardTone,
} from '~~/types/dashboard'
import { getSystemHealthSnapshot } from '../system-health'
import { readConfig } from '../config/store'
import { listSources } from '../playlist/store'
import { queryFailureRecords } from '../tasks/failure-records'
import { getSyncServiceInstance } from '../sync/instance'
import { getDb } from '../db'

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildSevenDayDownloadTrend(
  completedAt: readonly string[],
  now = new Date(),
): DashboardDownloadTrendPoint[] {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index))
    return {
      date: localDateKey(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      count: 0,
    }
  })
  const byDate = new Map(days.map(day => [day.date, day]))
  for (const timestamp of completedAt) {
    const parsed = new Date(timestamp)
    if (!Number.isFinite(parsed.getTime())) continue
    const bucket = byDate.get(localDateKey(parsed))
    if (bucket) bucket.count++
  }
  return days
}

function getSevenDayDownloadTrend(now = new Date()): DashboardDownloadTrendPoint[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
  const rows = getDb().prepare(`
    SELECT updated_at
    FROM download_tasks
    WHERE status = 'done' AND updated_at >= ?
    ORDER BY updated_at ASC
  `).all(start.toISOString()) as Array<{ updated_at: string }>
  return buildSevenDayDownloadTrend(rows.map(row => row.updated_at), now)
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
    if (!source.lastSyncedAt || source.lastStatus === 'idle') {
      summary.unsynced++
    } else if (source.lastStatus === 'failed') {
      summary.failed++
    } else if (source.lastStatus === 'partial' || hasFailures) {
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
  const [health, sources, copyrightFailures, downloadFailures, downloadTrend] = await Promise.all([
    getSystemHealthSnapshot(),
    Promise.resolve(listSources()),
    Promise.resolve(queryFailureRecords({ status: 'open', failureKind: 'copyright_restricted', limit: 1 })),
    Promise.resolve(queryFailureRecords({ status: 'open', failureKind: 'failed_download', limit: 1 })),
    Promise.resolve(getSevenDayDownloadTrend()),
  ])

  const healthSummary = buildSourceHealthSummary(sources)
  const pendingItems = buildPendingItems({
    copyrightCount: copyrightFailures.total,
    failedDownloadCount: downloadFailures.total,
    failedSourceCount: sources.filter((source) => source.lastStatus === 'failed').length,
  })

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
    pendingItems,
    sourceHealth: healthSummary,
    downloadTrend,
  }
}
