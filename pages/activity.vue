<template>
  <div class="activity-page">
    <PageHeader
      description="集中查看产品动态、运行入口与系统日志，不打断仪表盘的总览节奏"
    />

    <PageTabs
      :model-value="activeTab"
      :tabs="tabs"
      aria-label="动态视图"
      @change="switchTab"
    />

    <template v-if="activeTab === 'activity'">
      <section class="section-card activity-toolbar" aria-label="活动筛选">
        <form class="activity-search" @submit.prevent="applyActivitySearch">
          <label class="sr-only" for="activity-search-input">搜索活动</label>
          <AppIcon name="search" :size="15" />
          <input
            id="activity-search-input"
            v-model="activityQueryDraft"
            type="search"
            placeholder="搜索活动标题、摘要或类型"
          />
          <button class="btn btn-secondary btn-xs" type="submit">搜索</button>
        </form>

        <div class="activity-filter-group" aria-label="活动领域">
          <button
            v-for="filter in domainFilters"
            :key="filter.value"
            type="button"
            class="activity-filter"
            :class="{ 'activity-filter--active': activityDomain === filter.value }"
            @click="setActivityDomain(filter.value)"
          >
            {{ filter.label }}
          </button>
        </div>

        <div class="activity-filter-group" aria-label="活动状态">
          <button
            v-for="filter in severityFilters"
            :key="filter.value"
            type="button"
            class="activity-filter"
            :class="{ 'activity-filter--active': activitySeverity === filter.value }"
            @click="setActivitySeverity(filter.value)"
          >
            {{ filter.label }}
          </button>
        </div>

        <button
          v-if="hasActivityFilter"
          type="button"
          class="activity-clear-filter"
          @click="clearActivityFilters"
        >
          清除筛选
        </button>
      </section>

      <section class="section-card activity-section">
        <div class="activity-section__header">
          <div>
            <h2>最近活动</h2>
            <p>{{ activityTotal > 0 ? `共 ${activityTotal} 条活动，按发生时间倒序展示` : '同步、下载、Plex 与用户操作会出现在这里' }}</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="activityLoading" @click="fetchActivityEvents">
            <AppIcon :name="activityLoading ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': activityLoading }" />
            刷新
          </button>
        </div>

        <div v-if="activityLoading" class="activity-state">
          <span>加载活动中…</span>
        </div>
        <ProcessTimeline
          v-else-if="activityTimelineItems.length > 0"
          :items="activityTimelineItems"
          aria-label="最近活动时间线"
        />
        <EmptyState
          v-else
          title="暂无活动"
          :description="hasActivityFilter ? '当前筛选条件下没有匹配的活动' : '执行同步、下载或管理操作后会生成活动记录'"
        />

        <Pagination
          :has-more="activityHasMore"
          :loading="activityLoadingMore"
          :current-count="activityEvents.length"
          :total="activityTotal"
          @load-more="loadMoreActivityEvents"
        />
      </section>
    </template>

    <template v-if="activeTab === 'logs'">
      <section class="section-card activity-section">
        <div class="activity-section__header activity-section__header--wrap">
          <div>
            <div class="log-heading">
              <h2>系统日志</h2>
              <span>{{ logTotal }} 条</span>
              <span>自动保留 5000 条</span>
            </div>
          </div>
          <div class="log-actions">
            <div class="activity-filter-group" aria-label="日志级别">
              <button
                v-for="filter in logFilters"
                :key="filter.value"
                type="button"
                class="activity-filter"
                :class="{ 'activity-filter--active': logActiveFilter === filter.value }"
                @click="setLogFilter(filter.value)"
              >
                {{ filter.label }}
              </button>
            </div>
            <button class="btn btn-danger btn-sm" type="button" @click="showClearConfirm = true">清空日志</button>
          </div>
        </div>

        <div v-if="logLoading" class="activity-state">
          <span>加载日志中…</span>
        </div>
        <template v-else-if="logs.length > 0">
          <div class="log-list" role="list" aria-label="系统日志列表">
            <article
              v-for="log in logs"
              :key="log.id"
              class="log-row"
              role="listitem"
            >
              <time class="log-row__time" :datetime="log.timestamp">{{ formatLogTime(log.timestamp) }}</time>
              <span class="log-row__level" :class="logLevelClass(log.level)">{{ log.level.toUpperCase() }}</span>
              <span v-if="log.stage && log.stage !== 'idle'" class="log-row__stage">[{{ log.stage }}]</span>
              <p class="log-row__message">{{ log.message }}</p>
            </article>
          </div>
        </template>
        <EmptyState
          v-else
          title="暂无日志"
          :description="logActiveFilter ? '当前筛选条件下没有匹配的日志' : '执行同步任务后日志将出现在这里'"
        />

        <Pagination
          :has-more="logHasMore"
          :loading="logLoadingMore"
          :current-count="logs.length"
          :total="logTotal"
          @load-more="loadMoreLogs"
        />
      </section>

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
import type { ActivityDomain, ActivityEvent, ActivitySeverity } from '~~/server/lib/activity/types'
import type { LogEntry, LogLevel } from '~~/server/lib/log/types'
import type { ProcessTimelineItem } from '~~/lib/process-timeline'
import { buildActivityTimelineItems } from '~~/lib/activity-timeline'

const api = useApi()
const route = useRoute()
const router = useRouter()

const tabs = [
  { key: 'activity', label: '最近活动' },
  { key: 'logs', label: '系统日志' },
]
const activeTab = ref(route.query.tab === 'logs' ? 'logs' : 'activity')

function switchTab(tab: string) {
  if (!['activity', 'logs'].includes(tab)) return
  activeTab.value = tab
  void router.replace({
    query: {
      ...route.query,
      tab: tab === 'activity' ? undefined : tab,
    },
  })
}

watch(() => route.query.tab, (tab) => {
  activeTab.value = tab === 'logs' ? 'logs' : 'activity'
})

// --- Activity state ---
const ACTIVITY_PAGE_SIZE = 30
const activityEvents = ref<ActivityEvent[]>([])
const activityTotal = ref(0)
const activityOffset = ref(0)
const activityLoading = ref(false)
const activityLoadingMore = ref(false)
const activityDomain = ref<ActivityDomain | ''>('')
const activitySeverity = ref<ActivitySeverity | ''>('')
const activityQuery = ref('')
const activityQueryDraft = ref('')

const domainFilters: Array<{ label: string; value: ActivityDomain | '' }> = [
  { label: '全部', value: '' },
  { label: '同步', value: 'sync' },
  { label: '下载', value: 'download' },
  { label: 'Plex', value: 'plex' },
  { label: '用户操作', value: 'user' },
]

const severityFilters: Array<{ label: string; value: ActivitySeverity | '' }> = [
  { label: '全部状态', value: '' },
  { label: '完成', value: 'success' },
  { label: '关注', value: 'warning' },
  { label: '失败', value: 'error' },
  { label: '记录', value: 'info' },
]

const activityHasMore = computed(() => activityEvents.value.length < activityTotal.value)
const hasActivityFilter = computed(() => Boolean(activityDomain.value || activitySeverity.value || activityQuery.value))
const highlightedEventId = computed(() => typeof route.query.event === 'string' ? route.query.event : '')

const activityTimelineItems = computed<ProcessTimelineItem[]>(() =>
  buildActivityTimelineItems(activityEvents.value, { highlightedId: highlightedEventId.value }),
)

async function fetchActivityEvents() {
  activityLoading.value = true
  activityOffset.value = 0
  try {
    const res = await api.get<{ items: ActivityEvent[]; total: number }>('/activity-events', activityParams())
    activityEvents.value = res.items
    activityTotal.value = res.total
    await scrollToHighlightedActivity()
  } finally {
    activityLoading.value = false
  }
}

async function loadMoreActivityEvents() {
  if (activityLoadingMore.value || !activityHasMore.value) return
  activityLoadingMore.value = true
  try {
    const nextOffset = activityOffset.value + ACTIVITY_PAGE_SIZE
    const res = await api.get<{ items: ActivityEvent[]; total: number }>('/activity-events', activityParams(nextOffset))
    activityEvents.value = [...activityEvents.value, ...res.items]
    activityTotal.value = res.total
    activityOffset.value = nextOffset
    await scrollToHighlightedActivity()
  } finally {
    activityLoadingMore.value = false
  }
}

function activityParams(offset = 0): Record<string, string> {
  const params: Record<string, string> = {
    limit: String(ACTIVITY_PAGE_SIZE),
    offset: String(offset),
  }
  if (activityDomain.value) params.domain = activityDomain.value
  if (activitySeverity.value) params.severity = activitySeverity.value
  if (activityQuery.value) params.q = activityQuery.value
  return params
}

function setActivityDomain(domain: ActivityDomain | '') {
  activityDomain.value = domain
  void fetchActivityEvents()
}

function setActivitySeverity(severity: ActivitySeverity | '') {
  activitySeverity.value = severity
  void fetchActivityEvents()
}

function applyActivitySearch() {
  activityQuery.value = activityQueryDraft.value.trim()
  void fetchActivityEvents()
}

function clearActivityFilters() {
  activityDomain.value = ''
  activitySeverity.value = ''
  activityQuery.value = ''
  activityQueryDraft.value = ''
  void fetchActivityEvents()
}

async function scrollToHighlightedActivity() {
  if (!highlightedEventId.value) return
  await nextTick()
  document.getElementById(highlightedEventId.value)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// --- Log state ---
const LOG_PAGE_SIZE = 50
const logs = ref<LogEntry[]>([])
const logTotal = ref(0)
const logOffset = ref(0)
const logLoading = ref(false)
const logLoadingMore = ref(false)
const logActiveFilter = ref<LogLevel | ''>('')
const showClearConfirm = ref(false)
const logHasMore = computed(() => logs.value.length < logTotal.value)

const logFilters: Array<{ label: string; value: LogLevel | '' }> = [
  { label: '全部', value: '' },
  { label: '信息', value: 'info' },
  { label: '警告', value: 'warn' },
  { label: '错误', value: 'error' },
  { label: '调试', value: 'debug' },
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
  } finally {
    logLoading.value = false
  }
}

async function loadMoreLogs() {
  if (logLoadingMore.value || !logHasMore.value) return
  logLoadingMore.value = true
  try {
    const nextOffset = logOffset.value + LOG_PAGE_SIZE
    const params: Record<string, string> = { limit: String(LOG_PAGE_SIZE), offset: String(nextOffset) }
    if (logActiveFilter.value) params.level = logActiveFilter.value
    const res = await api.get<{ items: LogEntry[]; total: number }>('/logs', params)
    logs.value = [...logs.value, ...res.items]
    logTotal.value = res.total
    logOffset.value = nextOffset
  } finally {
    logLoadingMore.value = false
  }
}

function setLogFilter(level: LogLevel | '') {
  logActiveFilter.value = level
  void fetchLogs()
}

async function handleClearLogs() {
  showClearConfirm.value = false
  await api.del('/logs')
  logs.value = []
  logTotal.value = 0
}

function logLevelClass(level: LogLevel): string {
  if (level === 'error') return 'log-row__level--error'
  if (level === 'warn') return 'log-row__level--warn'
  if (level === 'debug') return 'log-row__level--debug'
  return 'log-row__level--info'
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

let sse: EventSource | null = null

watch(activeTab, (tab) => {
  if (tab === 'logs' && logs.value.length === 0) void fetchLogs()
  if (tab === 'activity' && activityEvents.value.length === 0) void fetchActivityEvents()
})

onMounted(async () => {
  await fetchActivityEvents()
  if (activeTab.value === 'logs') await fetchLogs()

  try {
    sse = new EventSource('/api/sync/events')
    sse.addEventListener('log', (e: MessageEvent) => {
      const data = JSON.parse(e.data) as LogEntry
      if (!logActiveFilter.value || data.level === logActiveFilter.value) {
        logs.value = [data, ...logs.value]
        logTotal.value++
      }
    })
  } catch { /* SSE unsupported */ }
})

onUnmounted(() => {
  if (sse) {
    sse.close()
    sse = null
  }
})
</script>

<style scoped>
.activity-page{display:grid;gap:1.5rem}
.activity-toolbar{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;padding:.85rem 1rem}
.activity-search{display:flex;min-width:min(100%,24rem);min-height:2.5rem;align-items:center;gap:.5rem;padding:0 .6rem;border:1px solid var(--border-primary);border-radius:999px;background:var(--bg-input);color:var(--text-tertiary)}
.activity-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--text-primary);font-size:.82rem}
.activity-search input::placeholder{color:var(--text-tertiary)}
.activity-filter-group{display:inline-flex;align-items:center;gap:.25rem;overflow:hidden;padding:.2rem;border:1px solid var(--border-primary);border-radius:999px;background:var(--bg-input)}
.activity-filter{display:inline-flex;min-height:2rem;align-items:center;justify-content:center;border:0;border-radius:999px;background:transparent;color:var(--text-tertiary);font-size:.75rem;font-weight:700;padding:0 .7rem;cursor:pointer;transition:background 150ms ease,color 150ms ease}
.activity-filter:hover{color:var(--text-primary);background:var(--bg-hover)}
.activity-filter:focus-visible,.activity-clear-filter:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 60%,white 40%);outline-offset:2px}
.activity-filter--active{background:var(--bg-surface);color:var(--accent);box-shadow:0 1px 2px rgba(15,23,42,.06)}
.activity-clear-filter{min-height:2.2rem;border:0;background:transparent;color:var(--accent);font-size:.75rem;font-weight:750;cursor:pointer}
.activity-section{display:grid;gap:1rem;padding:1rem 1.1rem}
.activity-section__header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}
.activity-section__header--wrap{flex-wrap:wrap}
.activity-section__header h2{margin:0;color:var(--text-primary);font-size:1rem;font-weight:760}
.activity-section__header p{margin:.25rem 0 0;color:var(--text-tertiary);font-size:.78rem}
.activity-state{display:flex;min-height:12rem;align-items:center;justify-content:center;color:var(--text-tertiary);font-size:.88rem}
.log-heading{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.log-heading span{display:inline-flex;min-height:1.55rem;align-items:center;padding:0 .55rem;border:1px solid var(--border-primary);border-radius:999px;background:var(--bg-input);color:var(--text-tertiary);font-size:.7rem;font-weight:700}
.log-actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;justify-content:flex-end}
.log-list{overflow:hidden;border:1px solid var(--border-primary);border-radius:var(--radius-lg);background:var(--bg-input)}
.log-row{display:grid;grid-template-columns:10.5rem 4.2rem max-content minmax(0,1fr);gap:.75rem;align-items:start;padding:.65rem .85rem;border-bottom:1px solid var(--border-primary);transition:background 150ms ease}
.log-row:last-child{border-bottom:0}
.log-row:hover{background:var(--bg-hover)}
.log-row__time{color:var(--text-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.7rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.log-row__level{display:inline-flex;min-height:1.45rem;align-items:center;justify-content:center;border:1px solid;border-radius:999px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.64rem;font-weight:800;letter-spacing:.02em}
.log-row__level--info{color:var(--existing);background:var(--existing-soft);border-color:var(--existing-border)}
.log-row__level--debug{color:var(--text-tertiary);background:var(--bg-muted);border-color:var(--border-secondary)}
.log-row__level--warn{color:var(--warning);background:var(--warning-soft);border-color:var(--warning-border)}
.log-row__level--error{color:var(--danger);background:var(--danger-soft);border-color:var(--danger-border)}
.log-row__stage{color:var(--text-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.7rem;white-space:nowrap}
.log-row__message{min-width:0;margin:0;color:var(--text-secondary);font-size:.78rem;line-height:1.55;overflow-wrap:anywhere}
@media(max-width:900px){
  .activity-toolbar{align-items:stretch}
  .activity-search{width:100%}
  .log-row{grid-template-columns:1fr;gap:.35rem}
  .log-row__level{justify-self:start;padding:0 .55rem}
}
</style>
