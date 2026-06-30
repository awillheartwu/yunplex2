<template>
  <div class="space-y-6">
    <PageHeader
      description="查看实时资源、运行状态与数据维护工具"
    />

    <PageTabs
      :model-value="activeTab"
      :tabs="tabs"
      aria-label="系统视图"
      @change="switchSystemTab"
    />

    <!-- Tab: 系统监控 -->
    <template v-if="activeTab === 'monitor'">
      <!-- KPI cards -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-2">CPU 使用率</p>
          <LazySystemLineChart :option="cpuChartOption" />
        </div>
        <div class="section-card p-4">
          <p class="text-2xs text-muted-deep mb-2">内存使用</p>
          <LazySystemLineChart :option="memChartOption" />
        </div>
      </div>

      <!-- Info + Stats -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

    <template v-if="activeTab === 'maintenance'">
      <section class="section-card p-5">
        <div class="mb-5">
          <h3 class="text-sm font-semibold">运行记录维护</h3>
          <p class="mt-1 text-2xs text-muted">按明确条件清理旧运行。待处理和已忽略的问题记录会保留，但被清理运行的详情将无法继续查看。</p>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label class="space-y-1.5 text-xs text-muted">
            <span>早于日期</span>
            <input v-model="cleanupBefore" type="date" class="form-input" />
          </label>
          <label class="space-y-1.5 text-xs text-muted">
            <span>运行类型</span>
            <select v-model="cleanupType" class="form-input">
              <option value="">全部类型</option>
              <option value="sync">同步</option>
              <option value="repair">补全</option>
              <option value="manual_download">手动下载</option>
            </select>
          </label>
          <label class="space-y-1.5 text-xs text-muted">
            <span>运行状态</span>
            <select v-model="cleanupStatus" class="form-input">
              <option value="">全部状态</option>
              <option value="success">成功</option>
              <option value="partial">部分成功</option>
              <option value="failed">失败</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
        </div>
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <button class="btn btn-danger" type="button" :disabled="!cleanupBefore || cleanupLoading" @click="showRunCleanupConfirm = true">
            <AppIcon :name="cleanupLoading ? 'loader' : 'trash'" :size="14" :class="{ 'animate-spin': cleanupLoading }" />
            清理运行记录
          </button>
          <span v-if="cleanupMessage" class="text-xs text-muted">{{ cleanupMessage }}</span>
        </div>
      </section>

      <ConfirmDialog
        :visible="showRunCleanupConfirm"
        title="清理运行记录"
        message="将删除符合条件的运行详情及已完成下载明细。待处理和已忽略的问题仍会保留，但可能失去原运行详情链接。此操作不可撤销。"
        confirm-label="确认清理"
        variant="danger"
        @confirm="handleRunCleanup"
        @cancel="showRunCleanupConfirm = false"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useIntervalFn } from '~~/composables/useTiming'
import { resolveLegacyActivityRedirect } from '~~/lib/activity-navigation'

const api = useApi()
const route = useRoute()
const legacyRedirect = resolveLegacyActivityRedirect(route.path, route.query)
if (legacyRedirect) {
  await navigateTo(legacyRedirect, { replace: true, redirectCode: 302 })
}
const router = useRouter()

// --- Tabs ---
const tabs = [
  { key: 'monitor', label: '系统监控' },
  { key: 'maintenance', label: '数据维护' },
]
const activeTab = ref(route.query.tab === 'maintenance' ? 'maintenance' : 'monitor')

function switchSystemTab(tab: string) {
  if (!['monitor', 'maintenance'].includes(tab)) return
  activeTab.value = tab
  void router.replace({ query: { ...route.query, tab: tab === 'monitor' ? undefined : tab } })
}

const cleanupBefore = ref('')
const cleanupType = ref('')
const cleanupStatus = ref('')
const cleanupLoading = ref(false)
const cleanupMessage = ref('')
const showRunCleanupConfirm = ref(false)

async function handleRunCleanup() {
  showRunCleanupConfirm.value = false
  cleanupLoading.value = true
  cleanupMessage.value = ''
  try {
    const response = await api.rawPost<{ count: number }>('/runs/cleanup', {
      before: cleanupBefore.value,
      type: cleanupType.value || undefined,
      status: cleanupStatus.value || undefined,
    })
    cleanupMessage.value = response.msg || `已清理 ${response.data?.count || 0} 条记录`
    await fetchStats()
  } catch {
    cleanupMessage.value = '清理失败，请稍后重试'
  } finally {
    cleanupLoading.value = false
  }
}

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
  task_runs: '统一运行记录',
  failure_records: '异常生命周期',
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

async function fetchStats() {
  try {
    const s = await api.get<SystemStats>('/system/stats')
    stats.value = s
    const time = formatTime(s.timestamp)
    cpuHistory.value = [...cpuHistory.value.slice(-MAX_POINTS + 1), { time, value: s.cpu }]
    memHistory.value = [...memHistory.value.slice(-MAX_POINTS + 1), { time, value: s.mem.rss }]
  } catch { /* ignore */ }
}

const statsPolling = useIntervalFn(() => { void fetchStats() }, 3000)

// --- Lifecycle ---
onMounted(async () => {
  try { info.value = await api.get('/system/info') } catch { /* ignore */ }
  await fetchStats()
  statsPolling.start()
})

onUnmounted(() => {
  statsPolling.stop()
})
</script>
