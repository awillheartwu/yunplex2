export function formatDashboardRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export function formatDashboardLastSyncLabel(iso: null | string): string {
  if (!iso) return '暂未同步'
  return `上次同步 ${formatDashboardRelativeTime(iso)}`
}
