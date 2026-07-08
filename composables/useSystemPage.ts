import { buildSystemDiagnosticReport } from '~~/lib/system-diagnostics'
import { resolveLegacyActivityRedirect } from '~~/lib/activity-navigation'
import { useDebounceFn, useIntervalFn } from '~~/composables/useTiming'
import { useFeedback } from '~~/composables/useFeedback'

type SystemTab = 'monitor' | 'maintenance'
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

export interface RunCleanupPreview {
  runCount: number
  downloadTaskCount: number
  linkedFailureCount: number
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

const tableDescs: Record<string, string> = {
  config: '系统配置',
  logs: '同步日志',
  task_runs: '统一运行记录',
  failure_records: '异常生命周期',
  playlist_sources: '歌单源',
  download_tasks: '下载队列',
  song_lookup: 'Plex 匹配缓存',
  sync_state: '同步运行时状态',
}

const tableLinks: Record<string, string> = {
  logs: '/activity?tab=logs',
  task_runs: '/task-center?tab=runs',
  failure_records: '/task-center?tab=failures',
  playlist_sources: '/sync-sources',
  download_tasks: '/manual-download?view=queue',
}

function historyChart(data: { time: string; value: number }[], unit: string, color: string, lightColor: string) {
  const hasData = data.length > 0
  return {
    grid: { top: 8, right: 8, bottom: 24, left: 44 },
    tooltip: {
      backgroundColor: 'rgba(24,24,27,0.96)',
      borderColor: 'rgba(255,255,255,0.06)',
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
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisTick: { show: false },
      axisLabel: { color: '#71717a', fontSize: 9, interval: hasData ? Math.max(Math.floor(data.length / 5), 1) : 0 },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: '#71717a', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)' } },
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
            { offset: 1, color: 'rgba(255,255,255,0)' },
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

function cleanupPreviewSummary(preview: RunCleanupPreview | null): string {
  if (!preview) return '选择日期范围后会预估影响范围'
  if (preview.runCount === 0) return '没有符合条件的运行记录'
  return `预计清理 ${preview.runCount} 条运行、${preview.downloadTaskCount} 条已完成/失败下载明细；${preview.linkedFailureCount} 条异常记录会保留但可能失去运行详情链接。`
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

export async function redirectLegacySystemRoute(route: ReturnType<typeof useRoute>) {
  const legacyRedirect = resolveLegacyActivityRedirect(route.path, route.query)
  if (legacyRedirect) {
    await navigateTo(legacyRedirect, { replace: true, redirectCode: 302 })
  }
}

export function useSystemPage() {
  const api = useApi()
  const route = useRoute()
  const router = useRouter()
  const feedback = useFeedback()
  const { state: syncState } = useSync()

  const tabs = [
    { key: 'monitor', label: '系统监控' },
    { key: 'maintenance', label: '运行记录' },
  ]
  const activeTab = ref<SystemTab>(route.query.tab === 'maintenance' ? 'maintenance' : 'monitor')
  const stats = ref<SystemStats | null>(null)
  const info = ref<SystemInfo | null>(null)
  const healthRefreshing = ref(false)
  const cpuHistory = ref<{ time: string; value: number }[]>([])
  const memHistory = ref<{ time: string; value: number }[]>([])

  const cleanupFrom = ref('')
  const cleanupTo = ref('')
  const cleanupType = ref('')
  const cleanupStatus = ref('')
  const cleanupLoading = ref(false)
  const cleanupMessage = ref('')
  const cleanupPreview = ref<RunCleanupPreview | null>(null)
  const cleanupPreviewLoading = ref(false)
  const cleanupPreviewError = ref('')
  const showRunCleanupConfirm = ref(false)

  const tableRows = computed(() => Object.entries(stats.value?.dbStats || {})
    .filter(([name]) => tableDescs[name])
    .map(([name, count]) => {
      const href = tableLinks[name]
      return {
        name,
        count,
        desc: tableDescs[name] ?? '',
        ...(href ? { href } : {}),
      }
    }))

  const cpuChartOption = computed(() => historyChart(cpuHistory.value, 'CPU %', '#818cf8', 'rgba(129,140,248,0.25)'))
  const memChartOption = computed(() => historyChart(memHistory.value, 'RSS MB', '#22c55e', 'rgba(34,197,94,0.2)'))
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

  const cleanupPreviewMessage = computed(() => cleanupPreviewSummary(cleanupPreview.value))
  const canCleanup = computed(() => Boolean((cleanupFrom.value || cleanupTo.value) && cleanupPreview.value && cleanupPreview.value.runCount > 0 && !cleanupPreviewLoading.value && !cleanupLoading.value))
  const cleanupConfirmMessage = computed(() => {
    const preview = cleanupPreview.value
    if (!preview) return '将删除符合条件的运行详情及已完成下载明细。此操作不可撤销。'
    return `将删除 ${preview.runCount} 条运行详情和 ${preview.downloadTaskCount} 条已完成/失败下载明细。${preview.linkedFailureCount} 条异常记录会保留，但可能失去原运行详情链接。此操作不可撤销。`
  })

  function switchSystemTab(tab: string) {
    if (tab !== 'monitor' && tab !== 'maintenance') return
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

  async function fetchCleanupPreview() {
    cleanupPreview.value = null
    cleanupPreviewError.value = ''
    if (!cleanupFrom.value && !cleanupTo.value) return
    cleanupPreviewLoading.value = true
    try {
      cleanupPreview.value = await api.post<RunCleanupPreview>('/runs/cleanup/preview', {
        from: cleanupFrom.value || undefined,
        to: cleanupTo.value || undefined,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        type: cleanupType.value || undefined,
        status: cleanupStatus.value || undefined,
      })
    } catch (error) {
      cleanupPreviewError.value = error instanceof Error ? error.message : '预估失败，请稍后重试'
    } finally {
      cleanupPreviewLoading.value = false
    }
  }

  const previewDebounce = useDebounceFn(fetchCleanupPreview, 250)
  watch([cleanupFrom, cleanupTo, cleanupType, cleanupStatus], () => previewDebounce.run())

  async function handleRunCleanup() {
    showRunCleanupConfirm.value = false
    cleanupLoading.value = true
    cleanupMessage.value = ''
    try {
      const response = await api.rawPost<RunCleanupPreview & { count: number }>('/runs/cleanup', {
        from: cleanupFrom.value || undefined,
        to: cleanupTo.value || undefined,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        type: cleanupType.value || undefined,
        status: cleanupStatus.value || undefined,
      })
      if (response.code !== 0) throw new Error(response.msg || '清理失败')
      cleanupMessage.value = response.msg || `已清理 ${response.data?.count || 0} 条记录`
      await Promise.all([fetchStats(), fetchCleanupPreview()])
      feedback.success('清理完成', cleanupMessage.value)
    } catch (error) {
      cleanupMessage.value = error instanceof Error ? error.message : '清理失败，请稍后重试'
      feedback.error('清理失败', cleanupMessage.value)
    } finally {
      cleanupLoading.value = false
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

  onMounted(async () => {
    try { info.value = await api.get<SystemInfo>('/system/info') } catch { /* keep partial monitor visible */ }
    await fetchStats()
    statsPolling.start()
  })

  onUnmounted(() => statsPolling.stop())

  return {
    activeTab,
    canCleanup,
    cleanupFrom,
    cleanupConfirmMessage,
    cleanupLoading,
    cleanupMessage,
    cleanupPreview,
    cleanupPreviewError,
    cleanupPreviewLoading,
    cleanupPreviewMessage,
    cleanupStatus,
    cleanupTo,
    cleanupType,
    copyDiagnostics,
    cpuChartOption,
    dependencyCheckedLabel,
    fetchCleanupPreview,
    fetchStats,
    formatDateTime,
    formatTime,
    formatUptime,
    handleRunCleanup,
    healthItems,
    healthRefreshing,
    info,
    kpiCards,
    lastStatsLabel,
    memChartOption,
    overallTone,
    refreshDependencyHealth,
    showRunCleanupConfirm,
    stats,
    switchSystemTab,
    tableRows,
    tabs,
  }
}
