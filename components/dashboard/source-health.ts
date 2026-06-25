import type { DashboardSourceHealthSummary } from '~~/types/dashboard'

export function getDashboardSourceHealthPercent(value: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((value / total) * 100)}%`
}

export function getDashboardSourceHealthWidth(value: number, total: number): string {
  if (total <= 0) return '0%'
  return `${(value / total) * 100}%`
}

export function getDashboardSourceHealthLegend(summary: DashboardSourceHealthSummary) {
  return [
    { key: 'normal', label: '正常', value: summary.normal, tone: 'success' },
    { key: 'warning', label: '警告', value: summary.warning, tone: 'warning' },
    { key: 'failed', label: '失败', value: summary.failed, tone: 'danger' },
    { key: 'unsynced', label: '未同步', value: summary.unsynced, tone: 'neutral' },
  ].map((item) => ({
    ...item,
    percent: getDashboardSourceHealthPercent(item.value, summary.total),
  }))
}
