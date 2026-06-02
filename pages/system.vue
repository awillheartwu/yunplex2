<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-sm font-semibold">系统</h2>
      <p class="text-2xs text-muted mt-0.5">实时资源监控 · 运行状态 · 日志</p>
    </div>

    <!-- Tab bar -->
    <div class="flex gap-1" style="border-bottom: 1px solid var(--border-primary)">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="px-4 py-2 text-sm font-medium transition-colors duration-150 border-b-2 -mb-px"
        :class="activeTab === tab.key
          ? 'border-accent text-accent'
          : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'"
        @click="activeTab = tab.key"
      >{{ tab.label }}</button>
    </div>

    <!-- Tab: 系统监控 -->
    <template v-if="activeTab === 'monitor'">
      <!-- KPI cards -->
      <div class="grid grid-cols-4 gap-4">
        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-1">CPU</p>
          <p class="text-xl font-semibold" style="color:var(--text-primary)">{{ stats?.cpu ?? '--' }}%</p>
        </div>
        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-1">内存 RSS</p>
          <p class="text-xl font-semibold" style="color:var(--text-primary)">{{ stats?.mem?.rss ?? '--' }} MB</p>
        </div>
        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-1">运行时间</p>
          <p class="text-xl font-semibold" style="color:var(--text-primary)">{{ formatUptime(stats?.uptime ?? 0) }}</p>
        </div>
        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-1">数据库</p>
          <p class="text-xl font-semibold" style="color:var(--text-primary)">{{ stats?.dbSize ?? '--' }} MB</p>
        </div>
      </div>

      <!-- Charts -->
      <div class="grid grid-cols-2 gap-4">
        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-2">CPU 使用率</p>
          <v-chart class="w-full" style="height:160px" :option="cpuChartOption" :autoresize="true" />
        </div>
        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-2">内存使用</p>
          <v-chart class="w-full" style="height:160px" :option="memChartOption" :autoresize="true" />
        </div>
      </div>

      <!-- Info + Stats -->
      <div class="grid grid-cols-2 gap-4">
        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-3">系统信息</p>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between"><span class="text-muted">版本</span><span style="color:var(--text-primary)">YunPlex2 v{{ info?.version ?? '-' }}</span></div>
            <div class="flex justify-between"><span class="text-muted">{{ info?.docker ? 'Docker' : '平台' }}</span><span style="color:var(--text-primary)">{{ info?.platform ?? '-' }}</span></div>
            <div class="flex justify-between"><span class="text-muted">Node.js</span><span style="color:var(--text-primary)" class="font-mono">{{ info?.nodeVersion ?? '-' }}</span></div>
            <div class="flex justify-between"><span class="text-muted">PID</span><span style="color:var(--text-primary)" class="font-mono">{{ stats?.pid ?? '-' }}</span></div>
            <div class="flex justify-between"><span class="text-muted">Plex</span><span :class="stats?.plexOk ? 'text-success' : 'text-danger'">{{ stats?.plexOk ? '可连接' : '无法连接' }}</span></div>
            <div class="flex justify-between"><span class="text-muted">网易云</span><span :class="stats?.neteaseOk ? 'text-success' : 'text-danger'">{{ stats?.neteaseOk ? '已登录' : '未登录/失效' }}</span></div>
          </div>
        </div>

        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-3">数据统计</p>
          <div v-if="stats?.dbStats" class="space-y-2 text-xs">
            <div v-for="(count, table) in tableMeta" :key="table" class="flex justify-between">
              <div>
                <span class="font-mono" style="color:var(--text-primary)">{{ table }}</span>
                <span class="text-muted-deep ml-2">{{ tableDesc(table) }}</span>
              </div>
              <span style="color:var(--text-primary)">{{ count.toLocaleString() }} 行</span>
            </div>
          </div>
          <p v-else class="text-2xs text-muted">暂无数据</p>
        </div>
      </div>
    </template>

    <!-- Tab: 日志 -->
    <template v-if="activeTab === 'logs'">
      <div>
        <div class="flex items-center justify-between mb-4">
          <p class="text-2xs text-muted">超过保留天数的日志自动清理，5,000 行硬上限兜底</p>
          <div class="flex items-center gap-4">
            <div class="flex items-center rounded-lg border border-[var(--border-secondary)] overflow-hidden">
              <button
                v-for="f in logFilters"
                :key="f.value"
                class="px-3 py-1.5 text-sm transition-colors"
                :class="logActiveFilter === f.value
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                  : 'text-muted hover:text-[var(--text-primary)]'"
                @click="setLogFilter(f.value)"
              >{{ f.label }}</button>
            </div>
            <button class="btn btn-danger btn-sm" @click="showClearConfirm = true">清空日志</button>
          </div>
        </div>

        <!-- Count bar -->
        <div v-if="logLoading" class="flex items-center justify-center py-16">
          <span class="text-sm text-muted">加载中...</span>
        </div>
        <template v-else-if="logs.length > 0">
          <div class="flex items-center justify-between text-2xs text-muted-deep mb-1">
            <span>共 {{ logTotal }} 条记录</span>
          </div>
          <div class="section-card overflow-hidden font-mono text-sm">
            <div class="overflow-x-auto">
              <div
                v-for="log in logs"
                :key="log.id"
                class="px-4 py-1.5 flex gap-4 hover:bg-[var(--bg-hover)] border-b border-[var(--border-primary)] last:border-0"
              >
                <span class="text-2xs text-muted-deep shrink-0 whitespace-nowrap">{{ formatLogTime(log.timestamp) }}</span>
                <span class="shrink-0 w-10" :class="logLevelColor(log.level)">{{ log.level.toUpperCase() }}</span>
                <span v-if="log.stage && log.stage !== 'idle'" class="text-muted-deep shrink-0">[{{ log.stage }}]</span>
                <span class="text-muted flex-1">{{ log.message }}</span>
              </div>
            </div>
          </div>
        </template>
        <EmptyState v-else-if="!logLoading" title="暂无日志" :description="logActiveFilter ? '当前筛选条件下没有匹配的日志' : '执行同步任务后日志将出现在这里'" />

        <Pagination
          :has-more="logHasMore"
          :loading="logLoadingMore"
          :current-count="logs.length"
          :total="logTotal"
          @load-more="loadMoreLogs"
        />
      </div>

      <ConfirmDialog
        :visible="showClearConfirm"
        title="清空日志"
        message="确定要清空所有同步日志吗？此操作不可撤销。"
        confirm-label="清空"
        variant="danger"
        @confirm="handleClearLogs"
        @cancel="showClearConfirm = false"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { TooltipComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { LogEntry, LogLevel } from '~~/server/lib/log/types'

use([LineChart, TooltipComponent, GridComponent, CanvasRenderer])

const api = useApi()

// --- Tabs ---
const tabs = [
  { key: 'monitor', label: '系统监控' },
  { key: 'logs', label: '日志' },
]
const route = useRoute()
const activeTab = ref((route.query.tab === 'logs' || route.query.tab === 'monitor') ? (route.query.tab as string) : 'monitor')

// --- System Monitor State ---
interface SystemStats {
  cpu: number; mem: { rss: number; heapUsed: number; heapTotal: number; external: number }
  uptime: number; pid: number; dbSize: number
  dbStats: Record<string, number>; plexOk: boolean; neteaseOk: boolean; timestamp: number
}

const stats = ref<SystemStats | null>(null)
const info = ref<Record<string, string> | null>(null)

const tableDescs: Record<string, string> = {
  config: '系统配置',
  logs: '同步日志',
  jobs: '同步任务记录',
  playlist_sources: '歌单源',
  download_tasks: '下载队列',
  song_lookup: 'Plex 匹配缓存',
  sync_state: '同步运行时状态',
}
function tableDesc(name: string): string { return tableDescs[name] || '' }
const tableMeta = computed(() => {
  if (!stats.value?.dbStats) return {}
  const m: Record<string, number> = {}
  for (const [k, v] of Object.entries(stats.value.dbStats)) {
    if (tableDescs[k]) m[k] = v
  }
  return m
})

const MAX_POINTS = 60
const cpuHistory = ref<{ time: string; value: number }[]>([])
const memHistory = ref<{ time: string; value: number }[]>([])

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

const cpuChartOption = computed(() => historyChart(cpuHistory.value, 'CPU %', '#818cf8', 'rgba(129,140,248,0.25)'))
const memChartOption = computed(() => historyChart(memHistory.value, 'RSS MB', '#22c55e', 'rgba(34,197,94,0.2)'))

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(s)}s`
}

let timer: ReturnType<typeof setInterval> | null = null

async function fetchStats() {
  try {
    const s = await api.get<SystemStats>('/system/stats')
    stats.value = s
    const time = formatTime(s.timestamp)
    cpuHistory.value = [...cpuHistory.value.slice(-MAX_POINTS + 1), { time, value: s.cpu }]
    memHistory.value = [...memHistory.value.slice(-MAX_POINTS + 1), { time, value: s.mem.rss }]
  } catch { /* ignore */ }
}

// --- Log State ---
const logs = ref<LogEntry[]>([])
const logTotal = ref(0)
const logLoading = ref(false)
const logLoadingMore = ref(false)
const logActiveFilter = ref<LogLevel | ''>('')
const showClearConfirm = ref(false)
const LOG_PAGE_SIZE = 50
const logOffset = ref(0)

const logHasMore = computed(() => logs.value.length < logTotal.value)

const logFilters: { label: string; value: LogLevel | '' }[] = [
  { label: '全部', value: '' },
  { label: '信息', value: 'info' },
  { label: '警告', value: 'warn' },
  { label: '错误', value: 'error' },
]

async function fetchLogs() {
  logLoading.value = true
  logOffset.value = 0
  try {
    const params: Record<string, string> = { limit: String(LOG_PAGE_SIZE) }
    if (logActiveFilter.value) params.level = logActiveFilter.value
    const res = await api.get<{ items: LogEntry[]; total: number }>('/logs', params)
    logs.value = res.items
    logTotal.value = res.total
  } catch { /* ignore */ } finally {
    logLoading.value = false
  }
}

async function loadMoreLogs() {
  if (logLoadingMore.value || !logHasMore.value) return
  logLoadingMore.value = true
  try {
    const newOffset = logOffset.value + LOG_PAGE_SIZE
    const params: Record<string, string> = { limit: String(LOG_PAGE_SIZE), offset: String(newOffset) }
    if (logActiveFilter.value) params.level = logActiveFilter.value
    const res = await api.get<{ items: LogEntry[]; total: number }>('/logs', params)
    logs.value = [...logs.value, ...res.items]
    logTotal.value = res.total
    logOffset.value = newOffset
  } catch { /* ignore */ } finally {
    logLoadingMore.value = false
  }
}

function setLogFilter(level: LogLevel | '') {
  logActiveFilter.value = level
  fetchLogs()
}

async function handleClearLogs() {
  showClearConfirm.value = false
  try {
    await api.del('/logs')
    logs.value = []
    logTotal.value = 0
  } catch { /* ignore */ }
}

function logLevelColor(level: string): string {
  switch (level) {
    case 'error': return 'text-danger'
    case 'warn': return 'text-warning'
    default: return 'text-muted-deep'
  }
}

function formatLogTime(ts: string): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${dd} ${h}:${mi}:${ss}`
}

// --- SSE log streaming ---
let sse: EventSource | null = null

// Lazy-load logs when switching to logs tab
watch(activeTab, (tab) => {
  if (tab === 'logs' && logs.value.length === 0) {
    fetchLogs()
  }
})

// --- Lifecycle ---
onMounted(async () => {
  try { info.value = await api.get('/system/info') } catch { /* ignore */ }
  await fetchStats()
  timer = setInterval(fetchStats, 3000)

  // If loaded directly with ?tab=logs, fetch initial logs
  if (activeTab.value === 'logs') {
    fetchLogs()
  }

  // SSE for real-time log streaming
  try {
    sse = new EventSource('/api/sync/events')
    sse.addEventListener('log', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      if (!logActiveFilter.value || data.level === logActiveFilter.value) {
        logs.value = [data as LogEntry, ...logs.value]
        logTotal.value++
      }
    })
  } catch { /* SSE unsupported */ }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (sse) { sse.close(); sse = null }
})
</script>
