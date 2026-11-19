import type { DownloadTask } from '~~/server/lib/download/queue'
import type { ResourceType } from './useManualDownload'

export const MANUAL_DOWNLOAD_QUALITY_LABELS: Record<string, string> = {
  jymaster: '臻品母带',
  jyeffect: '臻品',
  hires: 'Hi-Res',
  lossless: '无损',
  exhigh: '极高',
  higher: '较高',
  standard: '标准',
}

export function manualResourceTypeLabel(type: ResourceType | null | undefined): string {
  if (type === 'playlist') return '歌单'
  if (type === 'album') return '专辑'
  if (type === 'songs') return '单曲'
  return '未识别'
}

export function manualQualityLabel(quality: string | null | undefined): string {
  if (!quality) return '默认音质'
  return MANUAL_DOWNLOAD_QUALITY_LABELS[quality] ?? quality
}

export function manualDownloadStatusTone(status: DownloadTask['status'] | string): 'idle' | 'running' | 'success' | 'danger' {
  if (status === 'downloading' || status === 'tagging') return 'running'
  if (status === 'done') return 'success'
  if (status === 'failed') return 'danger'
  return 'idle'
}

export function formatManualDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '-'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatManualTotalDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '0 分钟'
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} 分钟`
  if (minutes === 0) return `${hours} 小时`
  return `${hours} 小时 ${minutes} 分钟`
}

export function formatManualRelativeTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const diffMin = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000))
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
