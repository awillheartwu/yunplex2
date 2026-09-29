<template>
  <NuxtLink
    :to="`/task-center/runs/${run.id}`"
    class="run-card"
    :aria-label="`查看${runTypeLabel(run.type)}运行：${displaySummary}`"
  >
    <div class="run-card__icon" :class="`run-card__icon--${typeTone}`">
      <AppIcon :name="runTypeIcon(run.type)" :size="18" />
    </div>
    <div class="run-card__body">
      <div class="run-card__heading">
        <h3 :title="displaySummary">{{ displaySummary }}</h3>
        <StatusBadge :status="badgeStatus" :label="displayStatusLabel" size="sm" />
      </div>
      <div class="run-card__meta">
        <span class="run-card__type">{{ runTypeLabel(run.type) }}</span>
        <span>{{ runTriggerLabel(run.trigger) }}</span>
        <span class="run-card__source" :title="run.source || '系统任务'">{{ run.source || '系统任务' }}</span>
      </div>
    </div>
    <div class="run-card__results" aria-label="运行结果">
      <span class="run-card__total">共 {{ run.totalSongs }} 项</span>
      <span
        v-for="item in visibleResults"
        :key="item.key"
        class="run-card__result"
        :class="semanticToneClass(item.tone)"
      >{{ item.label }} <strong>{{ item.count }}</strong></span>
    </div>
    <div class="run-card__time">
      <time :datetime="run.startedAt">{{ formatTime(run.startedAt) }}</time>
      <small>{{ run.sourceRequestStatus === 'pending' ? '等待执行' : run.status === 'running' ? '仍在运行' : formatRunDuration(run.durationMs) }}</small>
    </div>
    <AppIcon name="chevronRight" :size="15" class="run-card__chevron" />
  </NuxtLink>
</template>

<script setup lang="ts">
import type { TaskRunSummary } from '~~/server/lib/job/types'
import {
  formatRunDuration,
  runBadgeStatus,
  runSummaryLabel,
  runStatusLabel,
  runTriggerLabel,
  runTypeIcon,
  runTypeLabel,
  runTypeTone,
} from '~~/lib/run-presentation'
import { runResultItems, semanticToneClass } from '~~/lib/task-status'

const props = defineProps<{ run: TaskRunSummary }>()
const typeTone = computed(() => runTypeTone(props.run.type))
const badgeStatus = computed(() => props.run.sourceRequestStatus === 'pending' ? 'idle' : runBadgeStatus(props.run.status))
const displayStatusLabel = computed(() => props.run.sourceRequestStatus === 'pending' ? '等待执行' : runStatusLabel(props.run.status))
const displaySummary = computed(() => props.run.awaitingSourceSync
  ? '下载完成，待同步'
  : runSummaryLabel(props.run.summary, `${runTypeLabel(props.run.type)}运行`))
const visibleResults = computed(() => runResultItems(props.run as TaskRunSummary & { warnings: number }).filter(item => item.count > 0))
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.run-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, .65fr) auto auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--border-primary);
  background: var(--bg-surface);
  color: inherit;
  text-decoration: none;
  transition: background var(--duration-fast) ease;
}
.run-card + .run-card { border-top: 0; }
.run-card:first-child { border-radius: var(--radius-md) var(--radius-md) 0 0; }
.run-card:last-child { border-radius: 0 0 var(--radius-md) var(--radius-md); }
.run-card:only-child { border-radius: var(--radius-md); }
.run-card:hover { background: var(--bg-elevated); }
.run-card:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--accent); outline-offset: -2px; }
.run-card__icon {
  display: flex;
  width: 2rem;
  height: 2rem;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-secondary);
}
.run-card__icon--sync, .run-card__icon--initialization { color: var(--run-sync); }
.run-card__icon--download { color: var(--run-download); }
.run-card__icon--repair { color: var(--run-repair); }
.run-card__body { min-width: 0; }
.run-card__heading { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.run-card__heading h3 { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.run-card__heading > span { flex: none; }
.run-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
.run-card__meta > span + span::before { content: '·'; margin-right: var(--space-2); }
.run-card__type { color: var(--text-secondary); }
.run-card__source { min-width: 0; overflow-wrap: anywhere; }
.run-card__results { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-3); font-size: var(--text-xs); }
.run-card__total { color: var(--text-tertiary); white-space: nowrap; }
.run-card__result { display: inline-flex; gap: var(--space-1); background: none; white-space: nowrap; }
.run-card__result strong { font-weight: var(--font-weight-semibold); font-variant-numeric: tabular-nums; }
.run-card__time { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); font-size: var(--text-xs); color: var(--text-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.run-card__time small { font-size: inherit; color: var(--text-tertiary); }
.run-card__chevron { color: var(--text-tertiary); }
@media (max-width: 1200px) {
  .run-card { grid-template-columns: auto minmax(0, 1fr) auto auto; gap: var(--space-2) var(--space-3); }
  .run-card__results { grid-column: 2; }
  .run-card__time { grid-column: 3; grid-row: 1 / span 2; }
  .run-card__chevron { grid-column: 4; grid-row: 1 / span 2; }
}
@media (max-width: 720px) {
  .run-card { grid-template-columns: auto minmax(0, 1fr) auto; padding: var(--space-3); }
  .run-card__icon { align-self: start; }
  .run-card__results { grid-column: 2 / -1; }
  .run-card__time { grid-column: 2 / -1; grid-row: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .run-card__chevron { grid-column: 3; grid-row: 1; }
}
@media (prefers-reduced-motion: reduce) { .run-card { transition: none; } }
</style>
