<template>
  <div class="task-center-page">
    <PageHeader
      description="查看正在执行的工作、运行结果和需要处理的问题"
    />

    <PageTabs
      :model-value="activeTab"
      :tabs="taskCenterTabs"
      aria-label="任务中心视图"
      @change="onTaskCenterTabChange"
    />

    <main>
      <section v-if="activeTab === 'overview'" class="space-y-5">
        <article v-if="syncState?.isRunning" class="section-card task-live-card">
          <div class="task-live-card__top">
            <div>
              <div class="task-live-card__eyebrow">
                <span class="task-live-card__pulse" />
                当前同步
              </div>
              <h3>{{ liveTitle }}</h3>
              <p>{{ liveDescription }}</p>
            </div>
            <div class="task-live-card__percent">{{ livePercent }}%</div>
          </div>
          <div class="task-live-card__bar" aria-label="任务进度">
            <div :style="{ width: `${livePercent}%` }" />
          </div>
          <dl class="task-live-card__facts">
            <div>
              <dt>当前步骤</dt>
              <dd>{{ stageLabel }}</dd>
            </div>
            <div>
              <dt>当前项目</dt>
              <dd>{{ syncState.currentSong || syncState.currentSourceName || '正在准备' }}</dd>
            </div>
            <div>
              <dt>已运行</dt>
              <dd>{{ elapsedLabel }}</dd>
            </div>
            <div>
              <dt>本轮异常</dt>
              <dd :class="{ 'text-danger': (syncState.failures?.length || 0) > 0 }">{{ syncState.failures?.length || 0 }}</dd>
            </div>
          </dl>
          <div class="task-live-card__actions">
            <button class="btn btn-danger" type="button" @click="handleCancelSync">取消同步</button>
            <NuxtLink v-if="primaryActiveRun" :to="`/task-center/runs/${primaryActiveRun.id}`" class="btn btn-secondary">查看详情</NuxtLink>
          </div>
        </article>

        <article v-else class="section-card task-idle-card">
          <div class="task-idle-card__status">
            <span class="task-idle-card__status-dot" />
            系统空闲
          </div>
          <template v-if="latestRun">
            <div class="task-idle-card__main">
              <div>
                <p class="task-idle-card__eyebrow">最近一次运行</p>
                <h3>{{ latestRun.summary || runTypeLabel(latestRun.type) }}</h3>
                <p>{{ runTypeLabel(latestRun.type) }} · {{ formatTime(latestRun.startedAt) }} · {{ formatRunDuration(latestRun.durationMs) }}</p>
              </div>
              <StatusBadge :status="runBadgeStatus(latestRun.status)" />
            </div>
            <div class="task-idle-card__stats">
              <span><strong>{{ latestRun.totalSongs }}</strong> 项</span>
              <span><strong class="text-success">{{ latestRun.successSongs }}</strong> 成功</span>
              <span v-if="latestRun.skippedSongs > 0" class="text-existing"><strong>{{ latestRun.skippedSongs }}</strong> 已存在</span>
              <span v-if="latestRun.warnings > 0" class="text-ignored"><strong>{{ latestRun.warnings }}</strong> 已忽略</span>
              <span v-if="latestRun.removedSongs > 0" class="text-warning"><strong>{{ latestRun.removedSongs }}</strong> 已移除</span>
              <span v-if="latestRun.failedSongs > 0"><strong class="text-danger">{{ latestRun.failedSongs }}</strong> 失败</span>
            </div>
          </template>
          <div v-else class="task-idle-card__empty">
            <h3>还没有运行记录</h3>
            <p>触发同步或手动下载后，这里会显示最近结果。</p>
          </div>
          <div class="task-idle-card__actions">
            <button class="btn btn-primary" type="button" :disabled="syncLoading" @click="handleTriggerSync">
              <AppIcon :name="syncLoading ? 'loader' : 'sync'" :size="15" :class="{ 'animate-spin': syncLoading }" />
              {{ syncLoading ? '启动中' : '立即同步' }}
            </button>
            <NuxtLink v-if="latestRun" :to="`/task-center/runs/${latestRun.id}`" class="btn btn-secondary">查看详情</NuxtLink>
          </div>
          <p v-if="syncError" class="task-idle-card__error">{{ syncError }}</p>
        </article>

        <section v-if="secondaryActiveRuns.length > 0" class="section-card compact-runs">
          <div class="compact-runs__header">
            <div>
              <h3>其他正在运行</h3>
              <p>手动下载可以与同步并行，不会在概览中被隐藏。</p>
            </div>
            <span>{{ secondaryActiveRuns.length }}</span>
          </div>
          <NuxtLink v-for="run in secondaryActiveRuns" :key="run.id" :to="`/task-center/runs/${run.id}`" class="compact-run">
            <RunTypeBadge :type="run.type" compact size="sm" />
            <span>{{ run.summary }}</span>
            <small>{{ formatElapsed(run.startedAt) }}</small>
            <AppIcon name="chevronRight" :size="13" />
          </NuxtLink>
        </section>

        <section class="section-card issue-summary">
          <div>
            <p class="issue-summary__eyebrow">需要处理</p>
            <h3>{{ openFailureTotal > 0 ? `${openFailureTotal} 个问题等待处理` : '暂无待处理问题' }}</h3>
            <p>{{ openFailureTotal > 0 ? '失败项会在成功重试后自动关闭，也可以暂时忽略。' : '最近的运行没有留下未解决异常。' }}</p>
          </div>
          <button class="btn btn-secondary" type="button" @click="switchTab('failures')">
            {{ openFailureTotal > 0 ? '处理问题' : '查看异常记录' }}
          </button>
        </section>
      </section>

      <section v-else-if="activeTab === 'runs'" class="space-y-4">
        <FilterBar
          :search="runs.filter.value.search || ''"
          placeholder="搜索运行摘要、ID、来源或歌曲"
          search-label="搜索运行记录"
          :active-count="runAdvancedFilterCount"
          :can-clear="runCanClear"
          advanced
          :advanced-label="runAdvancedFilterLabel"
          advanced-title="高级筛选"
          @update:search="onRunSearch"
          @clear="clearRunFilters"
          @advanced-open="prepareRunDraftFilters"
        >
          <template #advanced>
            <div class="filter-sheet-group">
              <p class="filter-sheet-group__label">运行类型</p>
              <div class="filter-sheet-group__controls">
                <FilterChip v-for="item in runTypeFilters" :key="item.value || 'all'" :active="draftRunType === item.value" @click="draftRunType = item.value">
                  {{ item.label }}
                </FilterChip>
              </div>
            </div>
            <div class="filter-sheet-group">
              <p class="filter-sheet-group__label">运行状态</p>
              <div class="filter-sheet-group__controls">
                <FilterChip v-for="item in runStatusFilters" :key="item.value || 'all'" :active="draftRunStatus === item.value" @click="draftRunStatus = item.value">
                  {{ item.label }}
                </FilterChip>
              </div>
            </div>
            <div class="filter-sheet-group">
              <label class="filter-sheet-group__label" for="run-source-filter">来源</label>
              <select id="run-source-filter" v-model="draftRunSource" class="form-input">
                <option value="">全部来源</option>
                <option v-for="source in sourceOptions" :key="source.id" :value="source.id">{{ sourceOptionLabel(source) }}</option>
              </select>
            </div>
            <div class="filter-sheet-group">
              <p class="filter-sheet-group__label">日期范围</p>
              <DateRange :model-value="draftRunDateFilter" :min-date="runs.earliestDate.value" @update:model-value="setDraftRunDate" />
            </div>
          </template>

          <template #advanced-footer="{ close }">
            <button class="btn btn-secondary" type="button" @click="resetRunDraftFilters">重置</button>
            <button class="btn btn-primary" type="button" @click="applyRunDraftFilters(close)">应用</button>
          </template>

          <template #active-filters>
            <button
              v-for="chip in runFilterChips"
              :key="chip.key"
              type="button"
              class="filter-chip filter-chip-active filter-chip--removable"
              :aria-label="`移除筛选：${chip.label}`"
              @click="removeRunFilter(chip.key)"
            >
              <span>{{ chip.label }}</span>
              <span class="filter-chip__remove" aria-hidden="true"><AppIcon name="close" :size="12" /></span>
            </button>
          </template>

          <template #actions>
            <button class="btn btn-secondary btn-xs" type="button" :disabled="runs.loading.value" @click="runs.fetch()">
              <AppIcon :name="runs.loading.value ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': runs.loading.value }" />
              刷新
            </button>
          </template>
          <template #summary>
            <span v-if="runs.total.value > 0">共 {{ runs.total.value }} 次运行</span>
          </template>
        </FilterBar>

        <div v-if="runs.loading.value && runs.items.value.length === 0" class="task-loading">正在加载运行记录…</div>
        <EmptyState v-else-if="runs.items.value.length === 0" title="暂无运行记录" description="当前筛选条件下没有匹配的运行" />
        <div v-else class="run-groups">
          <section v-for="group in groupedRuns" :key="group.key" class="run-group">
            <h3>{{ group.label }}</h3>
            <div class="space-y-3">
              <RunCard v-for="run in group.items" :key="run.id" :run="run" />
            </div>
          </section>
          <Pagination :has-more="runs.hasMore.value" :loading="runs.loadingMore.value" :current-count="runs.items.value.length" :total="runs.total.value" @load-more="runs.loadMore()" />
        </div>
      </section>

      <section v-else class="space-y-4">
        <div class="failure-status-tabs" role="tablist" aria-label="异常状态">
          <button v-for="item in failureStatusTabs" :key="item.value" role="tab" type="button" :aria-selected="failures.filter.value.status === item.value" :class="{ 'is-active': failures.filter.value.status === item.value }" @click="setFailureStatus(item.value)">
            {{ item.label }}
          </button>
        </div>

        <FilterBar
          :search="failures.filter.value.search || ''"
          placeholder="搜索歌曲、艺人、原因或来源"
          search-label="搜索异常记录"
          :active-count="failureAdvancedFilterCount"
          :can-clear="failureCanClear"
          advanced
          :advanced-label="failureAdvancedFilterLabel"
          advanced-title="高级筛选"
          @update:search="onFailureSearch"
          @clear="clearFailureFilters"
          @advanced-open="prepareFailureDraftFilters"
        >
          <template #advanced>
            <div class="filter-sheet-group">
              <p class="filter-sheet-group__label">运行类型</p>
              <div class="filter-sheet-group__controls">
                <FilterChip v-for="item in failureTypeFilters" :key="item.value || 'all'" :active="draftFailureType === item.value" @click="draftFailureType = item.value">
                  {{ item.label }}
                </FilterChip>
              </div>
            </div>
            <div class="filter-sheet-group">
              <p class="filter-sheet-group__label">失败阶段</p>
              <div class="filter-sheet-group__controls">
                <FilterChip v-for="item in failureKindFilters" :key="item.value || 'all'" :active="draftFailureKind === item.value" @click="draftFailureKind = item.value">
                  {{ item.label }}
                </FilterChip>
              </div>
            </div>
            <div class="filter-sheet-group">
              <label class="filter-sheet-group__label" for="failure-source-filter">来源</label>
              <select id="failure-source-filter" v-model="draftFailureSource" class="form-input">
                <option value="">全部来源</option>
                <option v-for="source in sourceOptions" :key="source.id" :value="source.id">{{ sourceOptionLabel(source) }}</option>
              </select>
            </div>
            <div class="filter-sheet-group">
              <p class="filter-sheet-group__label">日期范围</p>
              <DateRange :model-value="draftFailureDateFilter" :min-date="null" @update:model-value="setDraftFailureDate" />
            </div>
          </template>

          <template #advanced-footer="{ close }">
            <button class="btn btn-secondary" type="button" @click="resetFailureDraftFilters">重置</button>
            <button class="btn btn-primary" type="button" @click="applyFailureDraftFilters(close)">应用</button>
          </template>

          <template #active-filters>
            <button
              v-for="chip in failureFilterChips"
              :key="chip.key"
              type="button"
              class="filter-chip filter-chip-active filter-chip--removable"
              :aria-label="`移除筛选：${chip.label}`"
              @click="removeFailureFilter(chip.key)"
            >
              <span>{{ chip.label }}</span>
              <span class="filter-chip__remove" aria-hidden="true"><AppIcon name="close" :size="12" /></span>
            </button>
          </template>

          <template #actions>
            <button class="btn btn-secondary btn-xs" type="button" :disabled="failures.loading.value" @click="failures.fetch()">
              <AppIcon :name="failures.loading.value ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': failures.loading.value }" />
              刷新
            </button>
          </template>
          <template #summary>
            <span v-if="failures.total.value > 0">共 {{ failures.total.value }} 个问题</span>
          </template>
        </FilterBar>

        <div v-if="selectedFailures.size > 0" class="failure-batch-bar">
          <span>已选 {{ selectedFailures.size }} 项</span>
          <button v-if="failures.filter.value.status === 'open'" class="btn btn-primary btn-xs" type="button" @click="batchRetry">批量重试</button>
          <button v-if="failures.filter.value.status === 'open'" class="btn btn-secondary btn-xs" type="button" @click="batchIgnore">批量忽略</button>
          <button v-if="failures.filter.value.status === 'ignored'" class="btn btn-secondary btn-xs" type="button" @click="batchReopen">恢复提醒</button>
          <button class="btn btn-ghost btn-xs" type="button" @click="selectedFailures.clear()">取消选择</button>
        </div>

        <div v-if="failures.loading.value && failures.items.value.length === 0" class="task-loading">正在加载异常记录…</div>
        <EmptyState v-else-if="failures.items.value.length === 0" :title="failureEmptyTitle" :description="failureEmptyDescription" />
        <div v-else class="section-card failure-list">
          <article v-for="record in failures.items.value" :key="record.id" class="failure-row">
            <input type="checkbox" :checked="selectedFailures.has(record.id)" :aria-label="`选择 ${record.songName}`" @change="toggleFailure(record.id)" />
            <div class="failure-row__main">
              <div class="failure-row__title">
                <strong>{{ record.songName }}</strong>
                <span>{{ record.artist }}</span>
                <span class="failure-kind" :class="semanticToneClass(failureKindTone(record.failureKind))">
                  <AppIcon :name="failureKindIcon(record.failureKind)" :size="11" />
                  {{ failureKindLabel(record.failureKind) }}
                </span>
              </div>
              <p>{{ failureReasonLabel(record) }}</p>
              <div class="failure-row__meta">
                <span>{{ record.sourceName || runTypeLabel(record.runType) }}</span>
                <span>首次 {{ formatTime(record.firstSeenAt) }}</span>
                <span>最近 {{ formatTime(record.lastSeenAt) }}</span>
                <span>{{ record.occurrenceCount }} 次</span>
                <span v-if="record.retryCount > 0">已重试 {{ record.retryCount }} 次</span>
              </div>
            </div>
            <div class="failure-row__actions">
              <NuxtLink v-if="record.runId" :to="`/task-center/runs/${record.runId}`" class="btn btn-ghost btn-xs">查看运行</NuxtLink>
              <button v-if="record.status === 'open' && isRetryable(record)" class="btn btn-secondary btn-xs failure-row__retry-button" type="button" @click="retryFailure(record.id)">重试</button>
              <span
                v-else-if="record.status === 'open'"
                class="failure-row__retry-tooltip"
                tabindex="0"
                :aria-label="`重试不可用：${failureRetryUnavailableReason(record)}`"
              >
                <button
                  class="btn btn-secondary btn-xs failure-row__retry-button is-disabled"
                  type="button"
                  disabled
                  :title="failureRetryUnavailableReason(record)"
                >重试</button>
                <span class="failure-row__tooltip" role="tooltip">{{ failureRetryUnavailableReason(record) }}</span>
              </span>
              <button v-if="record.status === 'open'" class="btn btn-ghost btn-xs" type="button" @click="ignoreFailure(record.id)">忽略</button>
              <button v-if="record.status === 'ignored'" class="btn btn-secondary btn-xs" type="button" @click="reopenFailure(record.id)">恢复提醒</button>
            </div>
          </article>
          <Pagination :has-more="failures.hasMore.value" :loading="failures.loadingMore.value" :current-count="failures.items.value.length" :total="failures.total.value" @load-more="failures.loadMore()" />
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { TaskSourceOption } from '~~/server/lib/task-filter-options'
import type { FailureRecord, FailureRecordStatus } from '~~/server/lib/tasks/failure-records'
import type { JobStatus, TaskRunSummary, TaskRunType } from '~~/server/lib/job/types'
import {
  countActiveFilters,
  parseAllowedQueryValue,
  parseDateQueryValue,
} from '~~/composables/useFilterQuery'
import { useFeedback } from '~~/composables/useFeedback'
import { useRuns } from '~~/composables/useRuns'
import { useDebounceFn } from '~~/composables/useTiming'
import { formatRunDuration, runTypeLabel } from '~~/lib/run-presentation'
import { semanticToneClass, type TaskSemanticTone } from '~~/lib/task-status'

type TaskCenterTab = 'overview' | 'runs' | 'failures'
const route = useRoute()
const router = useRouter()
const api = useApi()
const feedback = useFeedback()
const tabs: Array<{ key: TaskCenterTab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'runs', label: '运行记录' },
  { key: 'failures', label: '异常处理' },
]
const legacyTabs: Record<string, TaskCenterTab> = {
  activities: 'runs',
  'sync-history': 'runs',
  'download-history': 'runs',
  failures: 'failures',
}
const requestedTab = String(route.query.tab || 'overview')
const activeTab = ref<TaskCenterTab>(legacyTabs[requestedTab] || (['overview', 'runs', 'failures'].includes(requestedTab) ? requestedTab as TaskCenterTab : 'overview'))

const { state: syncState, loading: syncLoading, error: syncError, triggerSync, cancelSync } = useSync()
const runs = useRuns()
const failures = useFailures()
const sourceOptions = ref<TaskSourceOption[]>([])
const latestRun = ref<TaskRunSummary | null>(null)
const activeRunItems = ref<TaskRunSummary[]>([])
const primaryActiveRun = computed(() => activeRunItems.value.find(run => run.type === 'sync' || run.type === 'repair') || activeRunItems.value[0] || null)
const secondaryActiveRuns = computed(() => activeRunItems.value.filter(run => run.id !== primaryActiveRun.value?.id))
const openFailureTotal = ref(0)
const taskCenterTabs = computed(() => tabs.map(tab => ({
  ...tab,
  count: tab.key === 'failures' && openFailureTotal.value > 0 ? openFailureTotal.value : undefined,
  badgeTone: tab.key === 'failures' ? 'danger' as const : 'neutral' as const,
})))
const selectedFailures = ref(new Set<string>())

const stageLabels: Record<string, string> = {
  fetching_playlist: '获取歌单',
  comparing: '分析差异',
  downloading: '下载歌曲',
  processing_tags: '写入元数据',
  refreshing_plex: '刷新 Plex',
  updating_plex_playlist: '更新歌单',
  reorder: '校准顺序',
  repair: '补全资源',
}
const stageDescriptions: Record<string, string> = {
  fetching_playlist: '正在读取本轮同步范围和最新曲目。',
  comparing: '正在判断新增、移除和顺序变化。',
  downloading: '正在下载缺失歌曲并准备写入文件。',
  processing_tags: '正在写入歌词、封面和音频标签。',
  refreshing_plex: '正在等待 Plex 识别新文件。',
  updating_plex_playlist: '正在更新 Plex 歌单成员。',
  reorder: '正在将 Plex 顺序校准为目标顺序。',
  repair: '正在补齐缺失的歌词、封面或元数据。',
}
const stageWeights: Record<string, number> = {
  fetching_playlist: 8, comparing: 22, downloading: 56, processing_tags: 68,
  refreshing_plex: 82, updating_plex_playlist: 92, reorder: 98, repair: 50,
}
const stageLabel = computed(() => stageLabels[syncState.value?.currentStage || ''] || '准备运行')
const liveDescription = computed(() => stageDescriptions[syncState.value?.currentStage || ''] || '任务正在推进。')
const liveTitle = computed(() => syncState.value?.currentSourceName ? `${stageLabel.value} · ${syncState.value.currentSourceName}` : stageLabel.value)
const livePercent = computed(() => {
  const progress = syncState.value?.progress
  if (progress?.total) return Math.min(99, Math.round((progress.current / progress.total) * 100))
  return stageWeights[syncState.value?.currentStage || ''] || 4
})
const elapsedLabel = computed(() => formatElapsed(syncState.value?.startedAt || ''))

const runTypeFilters: Array<{ label: string; value: TaskRunType | '' }> = [
  { label: '全部类型', value: '' },
  { label: '同步', value: 'sync' },
  { label: '补全', value: 'repair' },
  { label: '手动下载', value: 'manual_download' },
]
const runStatusFilters: Array<{ label: string; value: JobStatus | '' }> = [
  { label: '全部状态', value: '' },
  { label: '运行中', value: 'running' },
  { label: '成功', value: 'success' },
  { label: '部分成功', value: 'partial' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
]
type RunFilterChipKey = 'search' | 'type' | 'status' | 'source' | 'date'
const draftRunType = ref<TaskRunType | ''>('')
const draftRunStatus = ref<JobStatus | ''>('')
const draftRunSource = ref('')
const draftRunFrom = ref<string | null>(null)
const draftRunTo = ref<string | null>(null)
const draftRunDateFilter = computed(() => ({ from: draftRunFrom.value, to: draftRunTo.value }))
const runAdvancedFilterCount = computed(() => countActiveFilters({
  type: runs.filter.value.type,
  status: runs.filter.value.status,
  sourceId: runs.filter.value.sourceId,
}) + (runs.filter.value.from || runs.filter.value.to ? 1 : 0))
const runActiveFilterCount = computed(() => countActiveFilters({
  search: runs.filter.value.search,
  type: runs.filter.value.type,
  status: runs.filter.value.status,
  sourceId: runs.filter.value.sourceId,
  from: runs.filter.value.from,
  to: runs.filter.value.to,
}))
const runCanClear = computed(() => runActiveFilterCount.value > 0)
const runAdvancedFilterLabel = computed(() => runAdvancedFilterCount.value > 0 ? '筛选' : '高级筛选')
const runFilterChips = computed<Array<{ key: RunFilterChipKey; label: string }>>(() => {
  const chips: Array<{ key: RunFilterChipKey; label: string }> = []
  if (runs.filter.value.search) chips.push({ key: 'search', label: `搜索：${runs.filter.value.search}` })
  if (runs.filter.value.type) chips.push({ key: 'type', label: `类型：${runTypeFilters.find(item => item.value === runs.filter.value.type)?.label || runs.filter.value.type}` })
  if (runs.filter.value.status) chips.push({ key: 'status', label: `状态：${runStatusFilters.find(item => item.value === runs.filter.value.status)?.label || runs.filter.value.status}` })
  if (runs.filter.value.sourceId) chips.push({ key: 'source', label: `来源：${sourceLabel(runs.filter.value.sourceId)}` })
  if (runs.filter.value.from || runs.filter.value.to) chips.push({ key: 'date', label: formatDateFilter(runs.filter.value.from, runs.filter.value.to) })
  return chips
})
const groupedRuns = computed(() => {
  const groups = new Map<string, { key: string; label: string; items: TaskRunSummary[] }>()
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const todayKey = localDateKey(today)
  const yesterdayKey = localDateKey(yesterday)

  for (const run of runs.items.value) {
    const date = new Date(run.startedAt)
    const key = localDateKey(date)
    const label = key === todayKey
      ? '今天'
      : key === yesterdayKey
        ? '昨天'
        : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
    const group = groups.get(key) || { key, label, items: [] }
    group.items.push(run)
    groups.set(key, group)
  }
  return [...groups.values()]
})

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

const failureStatusTabs: Array<{ label: string; value: FailureRecordStatus }> = [
  { label: '待处理', value: 'open' },
  { label: '已忽略', value: 'ignored' },
  { label: '已解决', value: 'resolved' },
]
const failureTypeFilters: Array<{ label: string; value: TaskRunType | '' }> = runTypeFilters
const failureKindFilters = [
  { label: '全部阶段', value: '' },
  { label: '下载失败', value: 'failed_download' },
  { label: '元数据失败', value: 'failed_tags' },
  { label: 'Plex 匹配失败', value: 'failed_plex_match' },
  { label: 'Plex 更新失败', value: 'failed_plex_insert' },
  { label: '版权受限', value: 'copyright_restricted' },
  { label: '重复失败', value: 'ignored_failure' },
]
type FailureFilterChipKey = 'search' | 'type' | 'kind' | 'source' | 'date'
const draftFailureType = ref<TaskRunType | ''>('')
const draftFailureKind = ref('')
const draftFailureSource = ref('')
const draftFailureFrom = ref<string | null>(null)
const draftFailureTo = ref<string | null>(null)
const draftFailureDateFilter = computed(() => ({ from: draftFailureFrom.value, to: draftFailureTo.value }))
const failureAdvancedFilterCount = computed(() => countActiveFilters({
  type: failures.filter.value.type,
  failureKind: failures.filter.value.failureKind,
  sourceId: failures.filter.value.sourceId,
}) + (failures.filter.value.from || failures.filter.value.to ? 1 : 0))
const failureActiveFilterCount = computed(() => countActiveFilters({
  search: failures.filter.value.search,
  type: failures.filter.value.type,
  failureKind: failures.filter.value.failureKind,
  sourceId: failures.filter.value.sourceId,
  from: failures.filter.value.from,
  to: failures.filter.value.to,
}))
const failureCanClear = computed(() => failureActiveFilterCount.value > 0)
const failureAdvancedFilterLabel = computed(() => failureAdvancedFilterCount.value > 0 ? '筛选' : '高级筛选')
const failureFilterChips = computed<Array<{ key: FailureFilterChipKey; label: string }>>(() => {
  const chips: Array<{ key: FailureFilterChipKey; label: string }> = []
  if (failures.filter.value.search) chips.push({ key: 'search', label: `搜索：${failures.filter.value.search}` })
  if (failures.filter.value.type) chips.push({ key: 'type', label: `类型：${failureTypeFilters.find(item => item.value === failures.filter.value.type)?.label || failures.filter.value.type}` })
  if (failures.filter.value.failureKind) chips.push({ key: 'kind', label: `阶段：${failureKindFilters.find(item => item.value === failures.filter.value.failureKind)?.label || failures.filter.value.failureKind}` })
  if (failures.filter.value.sourceId) chips.push({ key: 'source', label: `来源：${sourceLabel(failures.filter.value.sourceId)}` })
  if (failures.filter.value.from || failures.filter.value.to) chips.push({ key: 'date', label: formatDateFilter(failures.filter.value.from, failures.filter.value.to) })
  return chips
})
const failureEmptyTitle = computed(() => failures.filter.value.status === 'resolved' ? '暂无已解决问题' : failures.filter.value.status === 'ignored' ? '暂无已忽略问题' : '没有待处理问题')
const failureEmptyDescription = computed(() => failures.filter.value.status === 'open' ? '失败项重试成功后会自动从这里消失。' : '当前状态下没有匹配记录。')

function switchTab(tab: TaskCenterTab) {
  activeTab.value = tab
  void router.replace({ query: { ...route.query, tab: tab === 'overview' ? undefined : tab, id: undefined } })
}
function onTaskCenterTabChange(tab: string) {
  if (tab === 'overview' || tab === 'runs' || tab === 'failures') switchTab(tab)
}
function syncRunQuery() {
  void router.replace({ query: {
    ...route.query,
    tab: 'runs',
    runSearch: runs.filter.value.search || undefined,
    runType: runs.filter.value.type || undefined,
    runStatus: runs.filter.value.status || undefined,
    runSource: runs.filter.value.sourceId || undefined,
    runFrom: runs.filter.value.from || undefined,
    runTo: runs.filter.value.to || undefined,
  } })
}
function applyRunFilters() { syncRunQuery(); void runs.fetch() }
const runSearchDebounce = useDebounceFn(applyRunFilters, 350)
function onRunSearch(value: string) { runs.filter.value.search = value || undefined; syncRunQuery(); runSearchDebounce.run() }
function prepareRunDraftFilters() {
  draftRunType.value = runs.filter.value.type || ''
  draftRunStatus.value = runs.filter.value.status || ''
  draftRunSource.value = runs.filter.value.sourceId || ''
  draftRunFrom.value = runs.filter.value.from || null
  draftRunTo.value = runs.filter.value.to || null
}
function resetRunDraftFilters() {
  draftRunType.value = ''
  draftRunStatus.value = ''
  draftRunSource.value = ''
  draftRunFrom.value = null
  draftRunTo.value = null
}
function setDraftRunDate(value: { from: string | null; to: string | null }) {
  draftRunFrom.value = value.from
  draftRunTo.value = value.to
}
function applyRunDraftFilters(close?: () => void) {
  runs.filter.value.type = draftRunType.value || undefined
  runs.filter.value.status = draftRunStatus.value || undefined
  runs.filter.value.sourceId = draftRunSource.value || undefined
  runs.filter.value.from = draftRunFrom.value || undefined
  runs.filter.value.to = draftRunTo.value || undefined
  close?.()
  applyRunFilters()
}
function clearRunFilters() {
  runs.filter.value = {}
  resetRunDraftFilters()
  applyRunFilters()
}
function removeRunFilter(key: RunFilterChipKey) {
  if (key === 'search') runs.filter.value.search = undefined
  if (key === 'type') runs.filter.value.type = undefined
  if (key === 'status') runs.filter.value.status = undefined
  if (key === 'source') runs.filter.value.sourceId = undefined
  if (key === 'date') {
    runs.filter.value.from = undefined
    runs.filter.value.to = undefined
  }
  applyRunFilters()
}

function syncFailureQuery() {
  void router.replace({ query: {
    ...route.query,
    tab: 'failures',
    failureStatus: failures.filter.value.status === 'open' ? undefined : failures.filter.value.status,
    failureSearch: failures.filter.value.search || undefined,
    failureType: failures.filter.value.type || undefined,
    failureKind: failures.filter.value.failureKind || undefined,
    failureSource: failures.filter.value.sourceId || undefined,
    failureFrom: failures.filter.value.from || undefined,
    failureTo: failures.filter.value.to || undefined,
  } })
}
function applyFailureFilters() { selectedFailures.value = new Set(); syncFailureQuery(); void failures.fetch() }
const failureSearchDebounce = useDebounceFn(applyFailureFilters, 350)
function onFailureSearch(value: string) { failures.filter.value.search = value || undefined; failureSearchDebounce.run() }
function setFailureStatus(value: FailureRecordStatus) { failures.filter.value.status = value; applyFailureFilters() }
function prepareFailureDraftFilters() {
  draftFailureType.value = failures.filter.value.type || ''
  draftFailureKind.value = failures.filter.value.failureKind || ''
  draftFailureSource.value = failures.filter.value.sourceId || ''
  draftFailureFrom.value = failures.filter.value.from || null
  draftFailureTo.value = failures.filter.value.to || null
}
function resetFailureDraftFilters() {
  draftFailureType.value = ''
  draftFailureKind.value = ''
  draftFailureSource.value = ''
  draftFailureFrom.value = null
  draftFailureTo.value = null
}
function setDraftFailureDate(value: { from: string | null; to: string | null }) {
  draftFailureFrom.value = value.from
  draftFailureTo.value = value.to
}
function applyFailureDraftFilters(close?: () => void) {
  failures.filter.value.type = draftFailureType.value || undefined
  failures.filter.value.failureKind = draftFailureKind.value || undefined
  failures.filter.value.sourceId = draftFailureSource.value || undefined
  failures.filter.value.from = draftFailureFrom.value || undefined
  failures.filter.value.to = draftFailureTo.value || undefined
  close?.()
  applyFailureFilters()
}
function clearFailureFilters() {
  failures.filter.value = { status: failures.filter.value.status || 'open' }
  resetFailureDraftFilters()
  applyFailureFilters()
}
function removeFailureFilter(key: FailureFilterChipKey) {
  if (key === 'search') failures.filter.value.search = undefined
  if (key === 'type') failures.filter.value.type = undefined
  if (key === 'kind') failures.filter.value.failureKind = undefined
  if (key === 'source') failures.filter.value.sourceId = undefined
  if (key === 'date') {
    failures.filter.value.from = undefined
    failures.filter.value.to = undefined
  }
  applyFailureFilters()
}
function toggleFailure(id: string) {
  const next = new Set(selectedFailures.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedFailures.value = next
}
function isRetryable(record: FailureRecord) { return record.downloadTaskIds.length > 0 && record.failureKind !== 'copyright_restricted' }
function failureRetryUnavailableReason(record: FailureRecord): string {
  if (record.failureKind === 'copyright_restricted') return '版权受限无法在异常列表直接重试，请从运行或同步源重新执行。'
  if (record.downloadTaskIds.length === 0) return '这条异常没有可直接重试的下载任务，请从运行或同步源重新执行。'
  return '请从运行或同步源重新执行。'
}
async function retryFailure(id: string) { showMutationResult(await failures.batchRetry([id])) }
async function ignoreFailure(id: string) { showMutationResult(await failures.batchIgnore([id])) }
async function reopenFailure(id: string) { showMutationResult(await failures.batchReopen([id])) }
async function batchRetry() { showMutationResult(await failures.batchRetry([...selectedFailures.value])); selectedFailures.value = new Set() }
async function batchIgnore() { showMutationResult(await failures.batchIgnore([...selectedFailures.value])); selectedFailures.value = new Set() }
async function batchReopen() { showMutationResult(await failures.batchReopen([...selectedFailures.value])); selectedFailures.value = new Set() }
function showMutationResult(result: { count: number; msg: string }) {
  if (result.count > 0) feedback.success(result.msg || '操作已完成')
  else feedback.warning(result.msg || '没有可处理项目')
}

async function handleTriggerSync() { try { await triggerSync(); await refreshOverview() } catch { /* exposed by composable */ } }
async function handleCancelSync() { try { await cancelSync() } catch { /* exposed by composable */ } }
function runBadgeStatus(status: JobStatus): 'ok' | 'error' | 'warning' | 'running' | 'idle' {
  return status === 'success' ? 'ok' : status === 'failed' ? 'error' : status === 'partial' ? 'warning' : status === 'running' ? 'running' : 'idle'
}
function failureKindLabel(kind: string) {
  const labels: Record<string, string> = {
    failed_download: '下载失败', failed_tags: '元数据失败',
    failed_plex_match: 'Plex 匹配失败', failed_plex_insert: 'Plex 更新失败',
    copyright_restricted: '版权受限', ignored_failure: '重复失败',
  }
  return labels[kind] || kind
}
function failureKindTone(kind: string): TaskSemanticTone {
  if (kind === 'copyright_restricted' || kind === 'ignored_failure') return 'ignored'
  if (kind === 'failed_plex_match' || kind === 'failed_plex_insert') return 'warning'
  return 'failure'
}
function failureKindIcon(kind: string): string {
  const tone = failureKindTone(kind)
  if (tone === 'ignored') return 'ignored'
  if (tone === 'warning') return 'warn'
  return 'failure'
}
function failureReasonLabel(record: FailureRecord): string {
  const rawReason = record.failureReason?.trim()
  if (rawReason && rawReason !== record.failureKind) return rawReason
  const fallbacks: Record<string, string> = {
    failed_download: '歌曲在下载阶段失败，可重试或查看关联运行获取更多上下文。',
    failed_tags: '音频已下载，但元数据或标签写入未完成。',
    failed_plex_match: 'Plex 未在重试窗口内识别到已下载文件。',
    failed_plex_insert: 'Plex 已识别歌曲，但未能完成歌单更新。',
    copyright_restricted: '网易云未提供可下载音源，本次已按版权限制跳过。',
    ignored_failure: '连续失败达到忽略阈值，系统已暂停自动重试。',
  }
  return fallbacks[record.failureKind] || '未提供具体失败原因'
}
function sourceLabel(sourceId: string) {
  const source = sourceOptions.value.find(item => item.id === sourceId)
  return source ? sourceOptionLabel(source) : sourceId
}
function sourceOptionLabel(source: TaskSourceOption) {
  if (!source.deleted) return source.name
  const fallback = source.name === source.id ? source.id.slice(0, 8) : source.name
  return `${fallback}（已删除）`
}
function formatDateFilter(from?: string, to?: string) {
  if (from && to) return `日期：${from} 至 ${to}`
  if (from) return `日期：${from} 起`
  return `日期：截至 ${to}`
}
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function formatElapsed(value: string) {
  if (!value) return '刚开始'
  return formatRunDuration(Math.max(0, Date.now() - new Date(value).getTime()))
}
async function refreshOverview() {
  const [runResponse, activeResponse, failureResponse] = await Promise.all([
    api.get<{ items: TaskRunSummary[]; total: number }>('/runs', { limit: '1' }),
    api.get<{ items: TaskRunSummary[]; total: number }>('/runs', { limit: '20', status: 'running' }),
    api.get<{ items: FailureRecord[]; total: number }>('/tasks/failures', { limit: '1', status: 'open' }),
  ])
  latestRun.value = runResponse.items[0] || null
  activeRunItems.value = activeResponse.items
  openFailureTotal.value = failureResponse.total
}

onMounted(async () => {
  const runTypes = runTypeFilters.map(item => item.value).filter((value): value is TaskRunType => value !== '')
  const runStatuses = runStatusFilters.map(item => item.value).filter((value): value is JobStatus => value !== '')
  const failureKinds = failureKindFilters.map(item => item.value).filter((value): value is string => value !== '')
  const failureStatuses = failureStatusTabs.map(item => item.value)
  runs.filter.value = {
    search: typeof route.query.runSearch === 'string' ? route.query.runSearch : undefined,
    type: parseAllowedQueryValue(route.query.runType, runTypes),
    status: parseAllowedQueryValue(route.query.runStatus, runStatuses),
    sourceId: typeof route.query.runSource === 'string' ? route.query.runSource : undefined,
    from: parseDateQueryValue(route.query.runFrom),
    to: parseDateQueryValue(route.query.runTo),
  }
  failures.filter.value = {
    status: parseAllowedQueryValue(route.query.failureStatus, failureStatuses) || 'open',
    search: typeof route.query.failureSearch === 'string' ? route.query.failureSearch : undefined,
    type: parseAllowedQueryValue(route.query.failureType, runTypes),
    failureKind: parseAllowedQueryValue(route.query.failureKind, failureKinds),
    sourceId: typeof route.query.failureSource === 'string' ? route.query.failureSource : undefined,
    from: parseDateQueryValue(route.query.failureFrom),
    to: parseDateQueryValue(route.query.failureTo),
  }
  void router.replace({ query: {
    ...route.query,
    runType: runs.filter.value.type || undefined,
    runStatus: runs.filter.value.status || undefined,
    runFrom: runs.filter.value.from || undefined,
    runTo: runs.filter.value.to || undefined,
    failureStatus: failures.filter.value.status === 'open' ? undefined : failures.filter.value.status,
    failureType: failures.filter.value.type || undefined,
    failureKind: failures.filter.value.failureKind || undefined,
    failureFrom: failures.filter.value.from || undefined,
    failureTo: failures.filter.value.to || undefined,
  } })
  try {
    const options = await api.get<{ sources: TaskSourceOption[] }>('/task-center/filter-options')
    sourceOptions.value = options.sources
  } catch {
    sourceOptions.value = []
  }
  await Promise.all([runs.fetch(), failures.fetch(), refreshOverview()])
  const legacyId = typeof route.query.id === 'string' ? route.query.id : ''
  if (legacyId) await navigateTo(`/task-center/runs/${legacyId}`, { replace: true })
})

watch(() => syncState.value?.isRunning, (running, previous) => {
  if (running !== previous) void refreshOverview()
})
</script>

<style scoped>
.task-center-page{display:flex;flex-direction:column;gap:1.5rem;padding-bottom:2rem}
.task-live-card,.task-idle-card{padding:clamp(1.25rem,3vw,2rem);overflow:hidden}
.task-live-card{background:linear-gradient(135deg,var(--accent-muted),transparent 55%),var(--bg-surface)}
.task-live-card__top,.task-idle-card__main,.issue-summary,.compact-runs__header{display:flex;align-items:flex-start;justify-content:space-between;gap:1.25rem}
.task-live-card__eyebrow,.task-idle-card__status,.task-idle-card__eyebrow,.issue-summary__eyebrow{margin:0 0 .55rem;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-tertiary)}
.task-live-card__eyebrow{display:flex;align-items:center;gap:.5rem;color:var(--accent)}
.task-live-card__pulse,.task-idle-card__status-dot{width:.55rem;height:.55rem;border-radius:999px;background:var(--success);box-shadow:0 0 0 5px var(--success-soft)}
.task-live-card h3,.task-idle-card h3,.issue-summary h3,.compact-runs h3{margin:0;color:var(--text-primary);font-size:clamp(1.15rem,2.5vw,1.65rem)}
.task-live-card p,.task-idle-card p,.issue-summary p,.compact-runs p{margin:.55rem 0 0;color:var(--text-secondary);font-size:.82rem;line-height:1.6}
.task-live-card__percent{font-size:clamp(2rem,5vw,3.25rem);font-weight:800;letter-spacing:-.06em;color:var(--text-primary)}
.task-live-card__bar{height:.65rem;margin:1.4rem 0;overflow:hidden;border-radius:999px;background:var(--border-primary)}
.task-live-card__bar div{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--accent),var(--accent-soft));transition:width .3s ease}
.task-live-card__facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.8rem;margin:0}
.task-live-card__facts div{padding:1rem;border:1px solid var(--border-primary);border-radius:var(--radius-lg);background:var(--bg-input)}
.task-live-card__facts dt{font-size:.72rem;color:var(--text-tertiary)}
.task-live-card__facts dd{margin:.4rem 0 0;font-size:.88rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.task-live-card__actions,.task-idle-card__actions{display:flex;flex-wrap:wrap;gap:.65rem;margin-top:1.3rem}
.task-idle-card__status{display:flex;align-items:center;gap:.55rem;color:var(--success)}
.task-idle-card__main{margin-top:1rem}
.task-idle-card__stats{display:flex;flex-wrap:wrap;gap:1rem 1.8rem;margin-top:1.3rem;padding-top:1.1rem;border-top:1px solid var(--border-primary);color:var(--text-secondary);font-size:.8rem}
.task-idle-card__stats strong{font-size:1.05rem;color:var(--text-primary)}
.task-idle-card__error{padding:.8rem 1rem;border-radius:var(--radius-md);background:var(--danger-soft);color:var(--danger)!important}
.compact-runs{padding:1.15rem}
.compact-runs__header{padding:.2rem .25rem .9rem}
.compact-runs__header h3,.issue-summary h3{font-size:1rem}
.compact-runs__header>span{display:flex;width:2rem;height:2rem;align-items:center;justify-content:center;border-radius:999px;background:var(--accent-muted);color:var(--accent);font-weight:700}
.compact-run{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:.75rem;align-items:center;padding:.8rem .7rem;border-top:1px solid var(--border-primary);color:var(--text-secondary);text-decoration:none}
.compact-run span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);font-size:.82rem}
.compact-run small{font-size:.72rem;color:var(--text-tertiary)}
.issue-summary{align-items:center;padding:1.25rem 1.4rem}
.failure-status-tabs{display:inline-flex;align-self:flex-start;padding:.25rem;border:1px solid var(--border-primary);border-radius:var(--radius-lg);background:var(--bg-input)}
.failure-status-tabs button{min-height:2.4rem;padding:0 1rem;border:0;border-radius:var(--radius-md);background:transparent;color:var(--text-secondary);cursor:pointer}
.failure-status-tabs button.is-active{background:var(--bg-surface);color:var(--text-primary);box-shadow:var(--shadow-xs);font-weight:700}
.run-groups,.run-group{display:flex;flex-direction:column;gap:1rem}
.run-group>h3{margin:.5rem 0 0;font-size:.78rem;color:var(--text-tertiary)}
.failure-batch-bar{display:flex;min-height:3rem;align-items:center;gap:.65rem;padding:.5rem .8rem;border:1px solid var(--border-primary);border-radius:var(--radius-lg);background:var(--bg-surface);font-size:.78rem;color:var(--text-secondary)}
.failure-list{overflow:visible}
.failure-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:1rem;align-items:start;position:relative;padding:1rem 1.15rem;border-bottom:1px solid var(--border-primary);background:var(--bg-surface)}
.failure-row:last-of-type{border-bottom:0}
.failure-row__title{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem}
.failure-row__title strong{font-size:.86rem;color:var(--text-primary)}
.failure-row__title>span{font-size:.74rem;color:var(--text-tertiary)}
.failure-kind{display:inline-flex;align-items:center;gap:.3rem;padding:.16rem .45rem;border:1px solid;border-radius:.4rem;color:inherit!important;font-weight:650}
.failure-row__main>p{margin:.45rem 0 0;color:var(--text-secondary);font-size:.78rem;line-height:1.5}
.failure-row__meta{display:flex;flex-wrap:wrap;gap:.35rem .9rem;margin-top:.5rem;font-size:.7rem;color:var(--text-tertiary)}
.failure-row__actions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:.4rem;min-width:16rem;max-width:22rem}
.failure-row__retry-button{min-width:3.5rem}
.failure-row__retry-button.is-disabled{opacity:.58;cursor:not-allowed;box-shadow:none}
.failure-row__retry-tooltip{position:relative;display:inline-flex;border-radius:var(--radius-md)}
.failure-row__retry-tooltip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.failure-row__tooltip{position:absolute;right:50%;bottom:calc(100% + .55rem);z-index:20;width:max-content;max-width:16rem;padding:.45rem .6rem;border:1px solid var(--border-primary);border-radius:.65rem;background:var(--bg-elevated);box-shadow:var(--shadow-lg);color:var(--text-secondary);font-size:.68rem;font-weight:600;line-height:1.45;text-align:left;white-space:normal;opacity:0;visibility:hidden;transform:translate(50%,.2rem);transition:opacity 150ms ease,transform 150ms ease,visibility 150ms ease;pointer-events:none}
.failure-row__tooltip::after{content:"";position:absolute;right:50%;bottom:-.32rem;width:.58rem;height:.58rem;border-right:1px solid var(--border-primary);border-bottom:1px solid var(--border-primary);background:var(--bg-elevated);transform:translateX(50%) rotate(45deg)}
.failure-row__retry-tooltip:hover .failure-row__tooltip,.failure-row__retry-tooltip:focus-visible .failure-row__tooltip,.failure-row__retry-tooltip:focus-within .failure-row__tooltip{opacity:1;visibility:visible;transform:translate(50%,0)}
.task-loading{display:flex;min-height:12rem;align-items:center;justify-content:center;color:var(--text-secondary);font-size:.85rem}
@media(max-width:800px){.task-live-card__facts{grid-template-columns:repeat(2,minmax(0,1fr))}.failure-row{grid-template-columns:auto minmax(0,1fr)}.failure-row__actions{grid-column:2;justify-content:flex-start;min-width:0;max-width:none}.issue-summary{align-items:flex-start;flex-direction:column}}
@media(max-width:520px){.task-live-card__top,.task-idle-card__main{display:block}.task-live-card__percent{margin-top:1rem}.task-live-card__facts{grid-template-columns:1fr}.compact-run{grid-template-columns:auto minmax(0,1fr) auto}.compact-run small{display:none}}
</style>
