import type { ActivityDomain, ActivitySeverity } from '~~/server/lib/activity/types'

export type DashboardTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral'

export interface DashboardStatusItem {
  key: string
  label: string
  ok: boolean
}

export interface DashboardKpi {
  key: string
  label: string
  value: string
  note: string
  icon: string
  tone: DashboardTone
}

export interface DashboardTrendPoint {
  date: string
  count: number
}

export interface DashboardPendingItem {
  id: string
  title: string
  subtitle: string
  count: number
  icon: string
  tone: DashboardTone
  link: string
}

export interface DashboardActivityItem {
  id: string
  type: string
  domain: ActivityDomain
  severity: ActivitySeverity
  title: string
  subtitle: string
  timestamp: string
  icon: string
  tone: DashboardTone
  link: string
  groupKey?: string | null
  statusLabel?: string | null
}

export interface DashboardSourceHealthSummary {
  total: number
  normal: number
  warning: number
  failed: number
  unsynced: number
}

export interface DashboardSummary {
  status: {
    overallTone: DashboardTone
    overallLabel: string
    items: DashboardStatusItem[]
    lastSyncAt: string | null
    autoSyncEnabled: boolean
    syncRunning: boolean
  }
  kpis: DashboardKpi[]
  trend: {
    days: number
    points: DashboardTrendPoint[]
  }
  pendingItems: DashboardPendingItem[]
  recentActivities: DashboardActivityItem[]
  sourceHealth: DashboardSourceHealthSummary
}

export interface PlexRecentItem {
  ratingKey: string
  title: string
  artist: string
  album: string
  addedAt: string | null
  thumb: string | null
}
