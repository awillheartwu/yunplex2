<template>
  <section class="job-results" aria-label="运行结果统计">
    <div class="job-results__summary">
      <component
        :is="item.children?.length ? 'button' : 'div'"
        v-for="item in summary"
        :key="item.key"
        class="job-result"
        :class="[semanticToneClass(item.tone), { 'is-expanded': expanded === item.key }]"
        :type="item.children?.length ? 'button' : undefined"
        :aria-expanded="item.children?.length ? expanded === item.key : undefined"
        :aria-controls="item.children?.length ? detailId : undefined"
        @click="toggle(item)"
      >
        <AppIcon :name="item.icon" :size="14" />
        <strong>{{ item.count }}</strong>
        <span>{{ item.label }}</span>
        <AppIcon v-if="item.children?.length" name="chevronDown" :size="12" class="job-result__chevron" />
      </component>
    </div>
    <div
      v-if="expandedItem"
      :id="detailId"
      class="job-results__details"
      role="region"
      :aria-label="`${expandedItem.label}分类`"
    >
      <strong>{{ expandedItem.label }}</strong>
      <template v-for="item in expandedItem.children" :key="item.key">
        <button
          v-if="item.filter"
          type="button"
          class="job-results__detail is-filterable"
          :class="semanticToneClass(item.tone)"
          :aria-label="`筛选${item.label}的本次明细 ${item.detailCount ?? item.count} 条`"
          @click="emit('filter', item.filter)"
        >
          <AppIcon :name="item.icon" :size="12" />{{ item.label }} <b>{{ item.count }}</b>
          <small v-if="item.detailCount !== undefined">本次明细 {{ item.detailCount }} 条</small>
          <AppIcon name="arrowRight" :size="11" />
        </button>
        <span
          v-else
          class="job-results__detail is-aggregate"
          :class="semanticToneClass(item.tone)"
        >
          <AppIcon :name="item.icon" :size="12" />{{ item.label }} <b>{{ item.count }}</b>
        </span>
      </template>
      <p v-if="expandedItem.children?.some(item => item.detailCount !== undefined)" class="job-results__detail-note">本次明细按记录计数，与去重后的运行汇总不同。</p>
    </div>
    <p v-if="note" class="job-results__note" role="status">{{ note }}</p>
  </section>
</template>

<script setup lang="ts">
import { useId } from 'vue'
import type { TaskRun } from '~~/server/lib/job/types'
import {
  runResultItems,
  semanticToneClass,
  SONG_STATUS_BUCKETS,
  SONG_STATUS_GROUPS,
  songStatusBucketCount,
  type RunResultItem,
  type SongStatusFilter,
  type SongStatusGroup,
  type TaskSemanticTone,
} from '~~/lib/task-status'

interface SummaryItem {
  key: string
  label: string
  count: number
  tone: TaskSemanticTone
  icon: string
  filter?: SongStatusFilter
  detailCount?: number
  children?: SummaryItem[]
}
const props = defineProps<{ job: TaskRun }>()
const emit = defineEmits<{ filter: [filter: SongStatusFilter] }>()
const detailId = useId()
const expanded = ref<string | null>(null)
function groupSummary(run: TaskRun, key: SongStatusGroup, results: RunResultItem[]): SummaryItem {
  const group = SONG_STATUS_GROUPS.find((group) => group.key === key)!
  const songs = run.detailsExpired ? [] : run.songs
  const details: SummaryItem[] = group.buckets.map((bucket) => ({
    ...SONG_STATUS_BUCKETS.find((item) => item.key === bucket)!,
    count: songStatusBucketCount(songs, bucket),
    filter: bucket,
  })).filter((item) => item.count > 0)
  const aggregates = results.filter((item) => group.buckets.some((bucket) => bucket === item.key)
    || (key === 'attention' && ['failure', 'warnings', 'historical'].includes(item.key)))
  const failureCount = songStatusBucketCount(songs, 'failure')
  const completeFailures = failureCount > 0 && failureCount === run.failedSongs
  const children: SummaryItem[] = aggregates.filter((item) => item.count > 0
    && !(item.key === 'failure' && completeFailures)).map((item) => {
    const filter = item.key === 'failure' ? 'failure' : details.find((detail) => detail.key === item.key)?.filter
    const detailCount = filter ? songStatusBucketCount(songs, filter) : 0
    return {
      ...item,
      label: detailCount > 0 ? item.label : `${item.label}（仅汇总）`,
      filter: detailCount > 0 ? filter : undefined,
      detailCount: detailCount > 0 && detailCount !== item.count ? detailCount : undefined,
    }
  })
  children.push(...details
    .filter((detail) => !aggregates.some((item) => item.key === detail.key && item.count > 0))
    .map((detail) => ({ ...detail, label: key === 'attention' && !completeFailures && detail.key.startsWith('failed_')
      ? `${detail.label}（本次明细）` : detail.label })))
  return {
    key: group.key,
    label: group.label,
    tone: key === 'attention' && run.failedSongs > 0 ? 'failure' : group.tone,
    icon: group.icon,
    count: key === 'in_progress'
      ? songStatusBucketCount(songs, key)
      : aggregates.reduce((sum, item) => sum + item.count, 0),
    children,
  }
}

function totalItem(run: TaskRun): SummaryItem {
  return {
    key: 'total',
    label: run.status === 'running' ? '目标曲目' : run.type === 'source_initialization' ? '方案曲目' : '本次曲目',
    count: run.totalSongs,
    tone: 'neutral',
    icon: 'list',
  }
}

function initializationSummary(run: TaskRun): SummaryItem[] {
  const total = totalItem(run)
  const result = run.initializationResult
  if (result) {
    return [
      total,
      { key: 'adopted', label: '已接管', count: result.applied, tone: 'success', icon: 'checkCircle' },
      { key: 'downloads', label: '计划下载', count: result.downloads, tone: 'neutral', icon: 'download' },
      { key: 'deferred', label: '暂缓', count: result.deferred, tone: result.deferred > 0 ? 'warning' : 'neutral', icon: 'clock' },
      { key: 'conflicts', label: '冲突', count: result.conflicts, tone: result.conflicts > 0 ? 'failure' : 'neutral', icon: 'warn' },
    ]
  }
  const aggregates: SummaryItem[] = [
    { key: 'arranged', label: '已记录安排', count: run.successSongs, tone: 'neutral', icon: 'list' },
    { key: 'deferred', label: '暂缓', count: run.skippedSongs, tone: run.skippedSongs > 0 ? 'warning' : 'neutral', icon: 'clock' },
    { key: 'conflicts', label: '冲突/失败', count: run.failedSongs, tone: run.failedSongs > 0 ? 'failure' : 'neutral', icon: 'warn' },
  ]
  const active = run.status === 'running' || run.status === 'awaiting_action'
  const otherAggregates: SummaryItem[] = [
    ...(run.removedSongs > 0 ? [{ key: 'removed', label: '已移除', count: run.removedSongs, tone: 'neutral' as const, icon: 'minusCircle' }] : []),
    ...(run.warnings > 0 ? [{ key: 'warnings', label: '历史提示', count: run.warnings, tone: 'warning' as const, icon: 'warn' }] : []),
  ]
  return [total, ...aggregates.filter((item) => item.count > 0 || !active), ...otherAggregates]
}

const summary = computed<SummaryItem[]>(() => {
  const run = props.job
  if (run.type === 'source_initialization') return initializationSummary(run)
  const results = runResultItems(run)
  const result = (key: string) => results.find((item) => item.key === key)!
  const inProgress = groupSummary(run, 'in_progress', results)
  return [
    totalItem(run),
    result('success'),
    result('existing'),
    groupSummary(run, 'skipped', results),
    result('removed'),
    groupSummary(run, 'attention', results),
    ...(inProgress.count > 0 ? [inProgress] : []),
  ]
})
const note = computed(() => {
  const run = props.job
  if (run.type !== 'source_initialization') return ''
  if (run.initializationResult) return '“计划下载”表示已记录下载安排，文件完成情况以后续同步结果为准。'
  if (run.status === 'running') return '首次接管尚无完整提交结果，当前只显示已有聚合统计。'
  if (run.status === 'awaiting_action') return '首次接管方案仍在等待确认，尚无提交结果；当前只显示已有聚合统计。'
  return '提交结果明细不可用，以下仅显示历史聚合。“已记录安排”合并接管与计划下载，计划下载不代表文件已完成。'
})
const expandedItem = computed(() => summary.value.find((item) => item.key === expanded.value && item.children?.length))
function toggle(item: SummaryItem) {
  if (item.children?.length) expanded.value = expanded.value === item.key ? null : item.key
}
watch(
  () => props.job.id,
  () => {
    expanded.value = null
  },
)
</script>

<style scoped>
.job-results {
  min-width: 0;
}
.job-results__summary {
  display: flex;
  gap: var(--space-3);
  overflow-x: auto;
  padding: var(--space-1);
  margin: calc(-1 * var(--space-1));
}
.job-result {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  flex: 1 0 7.5rem;
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid;
  border-radius: var(--radius-lg);
  text-align: left;
  font: inherit;
}
.job-result > .app-icon:first-child {
  grid-row: 1 / span 2;
}
.job-result strong {
  font-size: var(--text-md);
  font-weight: var(--font-weight-bold);
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.job-result > span {
  grid-column: 2;
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
}
.job-result__chevron {
  grid-column: 3;
  grid-row: 1 / span 2;
  transition: transform var(--duration-fast);
}
button.job-result {
  cursor: pointer;
}
button.job-result:hover {
  filter: brightness(0.97);
}
button.job-result:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.job-result.is-expanded .job-result__chevron {
  transform: rotate(180deg);
}
.job-results__details {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin-top: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  font-size: var(--text-sm);
}
.job-results__details > strong {
  color: var(--text-secondary);
  font-weight: var(--font-weight-semibold);
}
.job-results__detail {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  min-height: 2rem;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  font: inherit;
}
.job-results__detail.is-filterable {
  cursor: pointer;
}
.job-results__detail.is-filterable:hover {
  background: var(--bg-hover);
}
.job-results__detail.is-filterable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.job-results__detail.is-aggregate {
  color: var(--text-secondary);
  background: transparent;
}
.job-results__detail b {
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.job-results__detail small {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.job-results__detail-note {
  flex-basis: 100%;
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.job-results__note {
  margin: var(--space-2) 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
}
@media (max-width: 720px) {
  .job-result {
    flex-basis: 7rem;
    padding: var(--space-2_5);
  }
}
</style>
