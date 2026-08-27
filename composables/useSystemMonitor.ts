import { buildSystemDiagnosticReport } from '~~/lib/system-diagnostics'
import { useIntervalFn } from '~~/composables/useTiming'
import { useFeedback } from '~~/composables/useFeedback'

type Tone = 'ok' | 'warning' | 'error' | 'idle'

export interface SystemStats {
  cpu: number
  mem: { rss: number; heapUsed: number; heapTotal: number; external: number }
  uptime: number
  pid: number
  dbSize: number
  plexOk: boolean
  neteaseOk: boolean
  dirWritable: boolean
  dependencyCheckedAt?: number
  dependencyCacheExpiresAt?: number
  dependencyCacheTtlMs?: number
  timestamp: number
}

export interface SystemInfo {
  version?: string
  platform?: string
  nodeVersion?: string
  docker?: boolean | string
}

export interface SystemKpiCard { label: string; value: string; detail: string; tone: Tone }
export interface SystemHealthItem { key: string; label: string; value: string; detail: string; tone: Tone }

function toneForCpu(value?: number): Tone {
  if (value === undefined) return 'idle'
  if (value >= 80) return 'error'
  if (value >= 55) return 'warning'
  return 'ok'
}

function toneForMemory(stats: SystemStats | null): Tone {
  if (!stats) return 'idle'
  if (stats.mem.rss >= 1536) return 'error'
  if (stats.mem.rss >= 1024) return 'warning'
  return 'ok'
}

function toneForDb(size?: number): Tone {
  if (size === undefined) return 'idle'
  if (size >= 512) return 'error'
  if (size >= 128) return 'warning'
  return 'ok'
}

function formatDateTime(ts?: number): string {
  if (!ts) return '尚未检测'
  return new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${Math.floor(seconds)}s`
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function useSystemMonitor() {
  const api = useApi()
  const feedback = useFeedback()
  const { state: syncState } = useSync()
  const stats = ref<SystemStats | null>(null)
  const info = ref<SystemInfo | null>(null)
  const healthRefreshing = ref(false)
  const dependencyCheckedLabel = computed(() => formatDateTime(stats.value?.dependencyCheckedAt))

  const kpiCards = computed<SystemKpiCard[]>(() => [
    { label: 'CPU', value: stats.value ? `${stats.value.cpu}%` : '--', detail: '当前进程采样', tone: toneForCpu(stats.value?.cpu) },
    { label: '应用内存', value: stats.value ? `${stats.value.mem.rss} MB` : '--', detail: stats.value ? `Heap ${stats.value.mem.heapUsed}/${stats.value.mem.heapTotal} MB` : '等待采样', tone: toneForMemory(stats.value) },
    { label: '运行时间', value: formatUptime(stats.value?.uptime || 0), detail: stats.value ? `PID ${stats.value.pid}` : '等待进程信息', tone: stats.value ? 'ok' : 'idle' },
    { label: '数据库', value: stats.value ? `${stats.value.dbSize} MB` : '--', detail: '自动执行有界保留', tone: toneForDb(stats.value?.dbSize) },
  ])

  const healthItems = computed<SystemHealthItem[]>(() => [
    { key: 'plex', label: 'Plex', value: stats.value?.plexOk ? '可连接' : '无法连接', detail: '媒体库与歌单更新', tone: stats.value?.plexOk ? 'ok' : 'error' },
    { key: 'netease', label: '网易云', value: stats.value?.neteaseOk ? '已登录' : '未登录/失效', detail: '歌单与下载链接', tone: stats.value?.neteaseOk ? 'ok' : 'error' },
    { key: 'download-dir', label: '下载目录', value: stats.value?.dirWritable ? '可写入' : '不可写', detail: '音频与标签写入', tone: stats.value?.dirWritable ? 'ok' : 'error' },
    { key: 'sync', label: '同步', value: syncState.value?.isRunning ? '运行中' : syncState.value?.lastSyncResult === 'failure' ? '最近失败' : '空闲', detail: syncState.value?.currentSourceName || syncState.value?.currentSong || '当前任务状态', tone: syncState.value?.isRunning ? 'warning' : syncState.value?.lastSyncResult === 'failure' ? 'error' : 'ok' },
  ])

  const overallTone = computed<Tone>(() => {
    if (!stats.value) return 'idle'
    if (healthItems.value.some(item => item.tone === 'error') || kpiCards.value.some(item => item.tone === 'error')) return 'error'
    if (healthItems.value.some(item => item.tone === 'warning') || kpiCards.value.some(item => item.tone === 'warning')) return 'warning'
    return 'ok'
  })

  async function fetchStats() {
    try {
      stats.value = await api.get<SystemStats>('/system/stats')
    } catch {
      feedback.warning('系统状态更新失败', '稍后会自动重试。')
    }
  }

  async function refreshDependencyHealth() {
    healthRefreshing.value = true
    try {
      const health = await api.post<Pick<SystemStats, 'plexOk' | 'neteaseOk' | 'dirWritable' | 'dependencyCheckedAt' | 'dependencyCacheExpiresAt' | 'dependencyCacheTtlMs'>>('/system/health/check')
      if (stats.value) stats.value = { ...stats.value, ...health }
      else await fetchStats()
      feedback.success('健康检查已刷新')
    } catch (error) {
      feedback.error('健康检查失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      healthRefreshing.value = false
    }
  }

  async function copyDiagnostics() {
    try {
      await writeClipboard(JSON.stringify(buildSystemDiagnosticReport({ info: info.value, stats: stats.value }), null, 2))
      feedback.success('诊断信息已复制', '敏感配置不会包含在诊断信息中。')
    } catch {
      feedback.error('复制失败', '当前浏览器不允许写入剪贴板。')
    }
  }

  const statsPolling = useIntervalFn(() => { void fetchStats() }, 10000)
  onMounted(async () => {
    try { info.value = await api.get<SystemInfo>('/system/info') } catch { /* diagnostics remain partially available */ }
    await fetchStats()
    statsPolling.start()
  })
  onUnmounted(() => statsPolling.stop())

  return { copyDiagnostics, dependencyCheckedLabel, healthItems, healthRefreshing, kpiCards, overallTone, refreshDependencyHealth }
}
