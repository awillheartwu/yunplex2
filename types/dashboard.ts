export type DashboardTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral'

export interface DashboardStatusItem {
  key: string
  label: string
  ok: boolean
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
  pendingItems: DashboardPendingItem[]
  sourceHealth: DashboardSourceHealthSummary
}
