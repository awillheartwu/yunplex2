import { buildSystemDiagnosticReport } from '~~/lib/system-diagnostics'
import { useIntervalFn } from '~~/composables/useTiming'
import { useFeedback } from '~~/composables/useFeedback'
import { buildSystemDataTableRows } from '~~/lib/system-data-catalog'

type SystemTab = 'monitor' | 'logs' | 'runs'
type Tone = 'ok' | 'warning' | 'error' | 'idle'

export interface SystemStats {
  cpu: number
  mem: { rss: number; heapUsed: number; heapTotal: number; external: number }
  uptime: number
  pid: number
  dbSize: number
  dbStats: Record<string, number>
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

export interface SystemKpiCard {
  label: string
  value: string
  detail: string
  tone: Tone
}

export interface SystemHealthItem {
  key: string
  label: string
  value: string
  detail: string
  tone: Tone
}

const MAX_POINTS = 60

function historyChart(
  data: { time: string; value: number }[],
  unit: string,
  color: string,
  lightColor: string,
  isDark: boolean,
) {
  const hasData = data.length > 0
  const axisColor = isDark ? '#9ca3af' : '#667085'
  const lineColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(30,41,59,0.12)'
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(30,41,59,0.08)'
  return {
    grid: { top: 8, right: 8, bottom: 24, left: 44 },
    tooltip: {
      backgroundColor: 'rgba(24,24,27,0.96)',
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.12)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#f4f4f6', fontSize: 12 },
      formatter(params: { name: string; value: number }) {
        return `${params.name}<br/><span style="color:#a1a1aa;font-size:11px">${unit}</span> ${params.value}`
      },
    },
    xAxis: {
      type: 'category' as const,
      data: data.map(d => d.time),
      axisLine: { lineStyle: { color: lineColor } },
      axisTick: { show: false },
      axisLabel: { color: axisColor, fontSize: 9, interval: hasData ? Math.max(Math.floor(data.length / 5), 1) : 0 },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: axisColor, fontSize: 10 },
      splitLine: { lineStyle: { color: gridColor } },
    },
    series: [{
      type: 'line' as const,
      data: data.map(d => d.value),
      smooth: true,
      symbol: 'none',
      lineStyle: { color, width: 2 },
      areaStyle: {
        color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: lightColor },
            { offset: 1, color: isDark ? 'rgba(15,23,42,0)' : 'rgba(255,255,255,0)' },
          ],
        },
      },
    }],
  }
}

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

function formatTime(ts?: number): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDateTime(ts?: number): string {
  if (!ts) return '尚未检测'
  return new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
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

export function useSystemPage() {
  const api = useApi()
  const route = useRoute()
  const router = useRouter()
  const feedback = useFeedback()
  const { theme } = useTheme()
  const { state: syncState } = useSync()

  const tabs = [
    { key: 'monitor', label: '系统监控' },
    { key: 'logs', label: '系统日志' },
    { key: 'runs', label: '运行记录' },
  ]
  const requestedTab = route.query.tab === 'maintenance' ? 'runs' : route.query.tab
  const activeTab = ref<SystemTab>(requestedTab === 'logs' || requestedTab === 'runs' ? requestedTab : 'monitor')
  const stats = ref<SystemStats | null>(null)
  const info = ref<SystemInfo | null>(null)
  const healthRefreshing = ref(false)
  const cpuHistory = ref<{ time: string; value: number }[]>([])
  const memHistory = ref<{ time: string; value: number }[]>([])

  const tableRows = computed(() => buildSystemDataTableRows(stats.value?.dbStats || {}))

  const cpuChartOption = computed(() => historyChart(
    cpuHistory.value,
    'CPU %',
    theme.value === 'dark' ? '#6f8fff' : '#3159c7',
    theme.value === 'dark' ? 'rgba(111,143,255,0.25)' : 'rgba(49,89,199,0.2)',
    theme.value === 'dark',
  ))
  const memChartOption = computed(() => historyChart(
    memHistory.value,
    'RSS MB',
    theme.value === 'dark' ? '#4ade80' : '#269653',
    theme.value === 'dark' ? 'rgba(74,222,128,0.2)' : 'rgba(38,150,83,0.17)',
    theme.value === 'dark',
  ))
  const lastStatsLabel = computed(() => stats.value ? `更新于 ${formatTime(stats.value.timestamp)}` : '等待采样')
  const dependencyCheckedLabel = computed(() => formatDateTime(stats.value?.dependencyCheckedAt))

  const kpiCards = computed<SystemKpiCard[]>(() => [
    {
      label: 'CPU',
      value: stats.value ? `${stats.value.cpu}%` : '--',
      detail: `最近 ${cpuHistory.value.length}/${MAX_POINTS} 个采样点`,
      tone: toneForCpu(stats.value?.cpu),
    },
    {
      label: '应用 RSS',
      value: stats.value ? `${stats.value.mem.rss} MB` : '--',
      detail: stats.value ? `Node Heap ${stats.value.mem.heapUsed}/${stats.value.mem.heapTotal} MB` : '等待采样',
      tone: toneForMemory(stats.value),
    },
    {
      label: '运行时间',
      value: formatUptime(stats.value?.uptime || 0),
      detail: stats.value ? `PID ${stats.value.pid}` : '等待进程信息',
      tone: stats.value ? 'ok' : 'idle',
    },
    {
      label: '数据库',
      value: stats.value ? `${stats.value.dbSize} MB` : '--',
      detail: `${tableRows.value.length} 张核心表`,
      tone: toneForDb(stats.value?.dbSize),
    },
  ])

  const healthItems = computed<SystemHealthItem[]>(() => [
    {
      key: 'plex',
      label: 'Plex',
      value: stats.value?.plexOk ? '可连接' : '无法连接',
      detail: '媒体库与歌单更新依赖',
      tone: stats.value?.plexOk ? 'ok' : 'error',
    },
    {
      key: 'netease',
      label: '网易云',
      value: stats.value?.neteaseOk ? '已登录' : '未登录/失效',
      detail: '歌单读取与下载链接依赖',
      tone: stats.value?.neteaseOk ? 'ok' : 'error',
    },
    {
      key: 'download-dir',
      label: '下载目录',
      value: stats.value?.dirWritable ? '可写入' : '不可写',
      detail: '下载和标签写入需要可写目录',
      tone: stats.value?.dirWritable ? 'ok' : 'error',
    },
    {
      key: 'sync',
      label: '同步状态',
      value: syncState.value?.isRunning ? '运行中' : syncState.value?.lastSyncResult === 'failure' ? '最近失败' : '空闲',
      detail: syncState.value?.currentSourceName || syncState.value?.currentSong || '最近同步状态',
      tone: syncState.value?.isRunning ? 'warning' : syncState.value?.lastSyncResult === 'failure' ? 'error' : 'ok',
    },
    {
      key: 'database',
      label: '数据库',
      value: toneForDb(stats.value?.dbSize) === 'ok' ? '正常' : toneForDb(stats.value?.dbSize) === 'warning' ? '偏大' : '需要关注',
      detail: stats.value ? `${stats.value.dbSize} MB，${tableRows.value.length} 张核心表` : '等待采样',
      tone: toneForDb(stats.value?.dbSize),
    },
  ])

  const overallTone = computed<Tone>(() => {
    if (!stats.value) return 'idle'
    if (healthItems.value.some(item => item.tone === 'error')) return 'error'
    if (healthItems.value.some(item => item.tone === 'warning')) return 'warning'
    return 'ok'
  })

  function switchSystemTab(tab: string) {
    if (tab !== 'monitor' && tab !== 'logs' && tab !== 'runs') return
    activeTab.value = tab
    void router.replace({ query: { ...route.query, tab: tab === 'monitor' ? undefined : tab } })
  }

  async function fetchStats() {
    try {
      const nextStats = await api.get<SystemStats>('/system/stats')
      stats.value = nextStats
      const time = formatTime(nextStats.timestamp)
      cpuHistory.value = [...cpuHistory.value.slice(-MAX_POINTS + 1), { time, value: nextStats.cpu }]
      memHistory.value = [...memHistory.value.slice(-MAX_POINTS + 1), { time, value: nextStats.mem.rss }]
    } catch {
      feedback.warning('系统状态更新失败', '稍后会自动重试。')
    }
  }

  async function refreshDependencyHealth() {
    healthRefreshing.value = true
    try {
      const dependencyHealth = await api.post<Pick<SystemStats, 'plexOk' | 'neteaseOk' | 'dirWritable' | 'dependencyCheckedAt' | 'dependencyCacheExpiresAt' | 'dependencyCacheTtlMs'>>('/system/health/check')
      if (stats.value) stats.value = { ...stats.value, ...dependencyHealth }
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
      const report = buildSystemDiagnosticReport({ info: info.value, stats: stats.value })
      await writeClipboard(JSON.stringify(report, null, 2))
      feedback.success('诊断信息已复制', '敏感配置不会包含在诊断信息中。')
    } catch {
      feedback.error('复制失败', '当前浏览器不允许写入剪贴板。')
    }
  }

  const statsPolling = useIntervalFn(() => { void fetchStats() }, 3000)

  async function startMonitor() {
    if (!info.value) {
      try { info.value = await api.get<SystemInfo>('/system/info') } catch { /* keep partial monitor visible */ }
    }
    await fetchStats()
    statsPolling.start()
  }

  onMounted(async () => {
    if (route.query.tab === 'maintenance') {
      await router.replace({ query: { ...route.query, tab: 'runs' } })
    }
    if (activeTab.value === 'monitor') await startMonitor()
  })

  watch(activeTab, (tab) => {
    if (tab === 'monitor') void startMonitor()
    else statsPolling.stop()
  })

  watch(() => route.query.tab, (tab) => {
    const nextTab: SystemTab = tab === 'maintenance' || tab === 'runs'
      ? 'runs'
      : tab === 'logs'
        ? 'logs'
        : 'monitor'
    if (activeTab.value !== nextTab) activeTab.value = nextTab
  })

  onUnmounted(() => statsPolling.stop())

  return {
    activeTab,
    copyDiagnostics,
    cpuChartOption,
    dependencyCheckedLabel,
    fetchStats,
    formatDateTime,
    formatTime,
    formatUptime,
    healthItems,
    healthRefreshing,
    info,
    kpiCards,
    lastStatsLabel,
    memChartOption,
    overallTone,
    refreshDependencyHealth,
    stats,
    switchSystemTab,
    tableRows,
    tabs,
  }
}
