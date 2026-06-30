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
      <FilterBar
        :search="activityQuery"
        placeholder="搜索活动标题、摘要或类型"
        search-label="搜索最近活动"
        :active-count="activityAdvancedFilterCount"
        :can-clear="hasActivityFilter"
        advanced
        :advanced-label="activityAdvancedFilterLabel"
        advanced-title="高级筛选"
        @update:search="onActivitySearch"
        @clear="clearActivityFilters"
        @advanced-open="prepareActivityDraftFilters"
      >
        <template #advanced>
          <div class="filter-sheet-group">
            <p class="filter-sheet-group__label">活动类型</p>
            <div class="filter-sheet-group__controls">
              <FilterChip
                v-for="filter in domainFilters"
                :key="filter.value || 'all-domain'"
                :active="draftActivityDomain === filter.value"
                @click="draftActivityDomain = filter.value"
              >
                {{ filter.label }}
              </FilterChip>
            </div>
          </div>
          <div class="filter-sheet-group">
            <p class="filter-sheet-group__label">活动状态</p>
            <div class="filter-sheet-group__controls">
              <FilterChip
                v-for="filter in severityFilters"
                :key="filter.value || 'all-severity'"
                :active="draftActivitySeverity === filter.value"
                @click="draftActivitySeverity = filter.value"
              >
                {{ filter.label }}
              </FilterChip>
            </div>
          </div>
        </template>

        <template #advanced-footer="{ close }">
          <button class="btn btn-secondary" type="button" @click="resetActivityDraftFilters">重置</button>
          <button class="btn btn-primary" type="button" @click="applyActivityDraftFilters(close)">应用</button>
        </template>

        <template #active-filters>
          <button
            v-for="chip in activityFilterChips"
            :key="chip.key"
            type="button"
            class="filter-chip filter-chip-active filter-chip--removable"
            :aria-label="`移除筛选：${chip.label}`"
            @click="removeActivityFilter(chip.key)"
          >
            <span>{{ chip.label }}</span>
            <span class="filter-chip__remove" aria-hidden="true"><AppIcon name="close" :size="12" /></span>
          </button>
        </template>

        <template #actions>
          <button class="btn btn-secondary btn-xs" type="button" :disabled="activityLoading" @click="fetchActivityEvents">
            <AppIcon :name="activityLoading ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': activityLoading }" />
            刷新
          </button>
        </template>

        <template #summary>
          <span v-if="activityTotal > 0">共 {{ activityTotal }} 条活动</span>
          <span v-else-if="hasActivityFilter">当前筛选条件下没有匹配的活动</span>
          <span v-else>同步、下载、Plex 与用户操作会出现在这里</span>
        </template>
      </FilterBar>

      <section class="section-card activity-section">
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
            <div class="log-filter-group" aria-label="日志级别">
              <FilterChip
                v-for="filter in logFilters"
                :key="filter.value || 'all-log-level'"
                :active="logActiveFilter === filter.value"
                @click="setLogFilter(filter.value)"
              >
                {{ filter.label }}
              </FilterChip>
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
import { useFeedback } from '~~/composables/useFeedback'
import { countActiveFilters } from '~~/composables/useFilterQuery'
import { useDebounceFn } from '~~/composables/useTiming'

const api = useApi()
const feedback = useFeedback()
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

type ActivityFilterChipKey = 'search' | 'domain' | 'severity'

const activityDomainValues = new Set<ActivityDomain>(['sync', 'download', 'plex', 'user'])
const activitySeverityValues = new Set<ActivitySeverity>(['success', 'warning', 'error', 'info'])

function queryString(key: string): string {
  const value = route.query[key]
  if (Array.isArray(value)) return value[0] ?? ''
  return typeof value === 'string' ? value : ''
}

function initialActivityDomain(): ActivityDomain | '' {
  const value = queryString('domain')
  return activityDomainValues.has(value as ActivityDomain) ? value as ActivityDomain : ''
}

function initialActivitySeverity(): ActivitySeverity | '' {
  const value = queryString('severity')
  return activitySeverityValues.has(value as ActivitySeverity) ? value as ActivitySeverity : ''
}

const activityDomain = ref<ActivityDomain | ''>(initialActivityDomain())
const activitySeverity = ref<ActivitySeverity | ''>(initialActivitySeverity())
const activityQuery = ref(queryString('q'))
const draftActivityDomain = ref<ActivityDomain | ''>('')
const draftActivitySeverity = ref<ActivitySeverity | ''>('')
const activityHasMore = computed(() => activityEvents.value.length < activityTotal.value)
const hasActivityFilter = computed(() => Boolean(activityDomain.value || activitySeverity.value || activityQuery.value))
const activityAdvancedFilterCount = computed(() => countActiveFilters({
  domain: activityDomain.value,
  severity: activitySeverity.value,
}))
const activityAdvancedFilterLabel = computed(() => activityAdvancedFilterCount.value > 0 ? '筛选' : '高级筛选')
const highlightedEventId = computed(() => typeof route.query.event === 'string' ? route.query.event : '')

const activityTimelineItems = computed<ProcessTimelineItem[]>(() =>
  buildActivityTimelineItems(activityEvents.value, { highlightedId: highlightedEventId.value }),
)
const activityFilterChips = computed<Array<{ key: ActivityFilterChipKey; label: string }>>(() => {
  const chips: Array<{ key: ActivityFilterChipKey; label: string }> = []
  if (activityQuery.value) chips.push({ key: 'search', label: `搜索：${activityQuery.value}` })
  if (activityDomain.value) chips.push({ key: 'domain', label: `类型：${domainFilters.find(item => item.value === activityDomain.value)?.label ?? activityDomain.value}` })
  if (activitySeverity.value) chips.push({ key: 'severity', label: `状态：${severityFilters.find(item => item.value === activitySeverity.value)?.label ?? activitySeverity.value}` })
  return chips
})

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

function syncActivityFilterQuery() {
  void router.replace({
    query: {
      ...route.query,
      q: activityQuery.value || undefined,
      domain: activityDomain.value || undefined,
      severity: activitySeverity.value || undefined,
    },
  })
}

function applyActivityFilters() {
  syncActivityFilterQuery()
  void fetchActivityEvents()
}

const activitySearchDebounce = useDebounceFn(applyActivityFilters, 350)

function onActivitySearch(value: string) {
  activityQuery.value = value
  syncActivityFilterQuery()
  activitySearchDebounce.run()
}

function prepareActivityDraftFilters() {
  draftActivityDomain.value = activityDomain.value
  draftActivitySeverity.value = activitySeverity.value
}

function resetActivityDraftFilters() {
  draftActivityDomain.value = ''
  draftActivitySeverity.value = ''
}

function applyActivityDraftFilters(close?: () => void) {
  activityDomain.value = draftActivityDomain.value
  activitySeverity.value = draftActivitySeverity.value
  close?.()
  applyActivityFilters()
}

function clearActivityFilters() {
  activityDomain.value = ''
  activitySeverity.value = ''
  activityQuery.value = ''
  resetActivityDraftFilters()
  applyActivityFilters()
}

function removeActivityFilter(key: ActivityFilterChipKey) {
  if (key === 'search') activityQuery.value = ''
  if (key === 'domain') activityDomain.value = ''
  if (key === 'severity') activitySeverity.value = ''
  applyActivityFilters()
}

watch(() => [route.query.q, route.query.domain, route.query.severity], () => {
  const nextQuery = queryString('q')
  const nextDomain = initialActivityDomain()
  const nextSeverity = initialActivitySeverity()
  if (
    nextQuery === activityQuery.value
    && nextDomain === activityDomain.value
    && nextSeverity === activitySeverity.value
  ) return

  activityQuery.value = nextQuery
  activityDomain.value = nextDomain
  activitySeverity.value = nextSeverity
  resetActivityDraftFilters()
  if (activeTab.value === 'activity') void fetchActivityEvents()
})

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
  try {
    await api.del('/logs')
    logs.value = []
    logTotal.value = 0
    logOffset.value = 0
    feedback.success('系统日志已清空')
  } catch (err) {
    feedback.error('清空日志失败', err instanceof Error ? err.message : '请稍后重试')
  }
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
.activity-section{display:grid;gap:1rem;padding:1rem 1.1rem}
.activity-section__header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}
.activity-section__header--wrap{flex-wrap:wrap}
.activity-section__header h2{margin:0;color:var(--text-primary);font-size:1rem;font-weight:760}
.activity-section__header p{margin:.25rem 0 0;color:var(--text-tertiary);font-size:.78rem}
.activity-state{display:flex;min-height:12rem;align-items:center;justify-content:center;color:var(--text-tertiary);font-size:.88rem}
.log-heading{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.log-heading span{display:inline-flex;min-height:1.55rem;align-items:center;padding:0 .55rem;border:1px solid var(--border-primary);border-radius:999px;background:var(--bg-input);color:var(--text-tertiary);font-size:.7rem;font-weight:700}
.log-actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;justify-content:flex-end}
.log-filter-group{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
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
  .log-row{grid-template-columns:1fr;gap:.35rem}
  .log-row__level{justify-self:start;padding:0 .55rem}
}
</style>
