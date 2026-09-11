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
      <div class="run-card__meta">
        <RunTypeBadge :type="run.type" compact size="sm" />
        <StatusBadge :status="badgeStatus" :label="displayStatusLabel" size="sm" />
        <span class="run-card__trigger">{{ runTriggerLabel(run.trigger) }}</span>
      </div>
      <h3>{{ displaySummary }}</h3>
    </div>
    <div class="run-card__details">
      <div class="run-card__source-column">
        <span class="run-card__column-label">来源</span>
        <span v-if="run.source" class="run-card__source" :title="run.source">
          <AppIcon name="source" :size="12" />
          {{ run.source }}
        </span>
        <span v-else class="run-card__source">系统任务</span>
      </div>
      <div class="run-card__results">
        <span class="run-card__column-label">结果</span>
        <span class="run-card__total">{{ run.totalSongs }} 项</span>
        <span
          v-for="item in visibleResults"
          :key="item.key"
          class="run-card__result"
          :class="semanticToneClass(item.tone)"
        >
          <span aria-hidden="true" />
          {{ item.count }} {{ item.label }}
        </span>
      </div>
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
.run-card{display:grid;grid-template-columns:auto minmax(17rem,1.15fr) minmax(24rem,1.5fr) minmax(7rem,auto) auto;gap:var(--space-4);align-items:center;position:relative;padding:var(--space-3) var(--space-4);border:1px solid var(--border-primary);border-bottom:0;background:var(--bg-surface);text-decoration:none;color:inherit;transition:border-color var(--duration-fast) ease,background var(--duration-fast) ease,box-shadow var(--duration-fast) ease,transform var(--duration-fast) ease}
.run-card:first-child{border-radius:var(--radius-xl) var(--radius-xl) 0 0}
.run-card:last-child{border-bottom:1px solid var(--border-primary);border-radius:0 0 var(--radius-xl) var(--radius-xl)}
.run-card:only-child{border-radius:var(--radius-xl)}
.run-card:hover{z-index:1;border-color:var(--border-secondary);background:var(--bg-elevated);box-shadow:var(--shadow-sm);transform:translateX(2px)}
.run-card:focus-visible{z-index:2;outline:2px solid var(--accent);outline-offset:2px}
.run-card__icon{display:flex;width:2.25rem;height:2.25rem;align-items:center;justify-content:center;border-radius:var(--radius-lg);background:var(--bg-input);color:var(--text-secondary)}
.run-card__icon--sync{background:var(--run-sync-soft);color:var(--run-sync);border:1px solid var(--run-sync-border)}
.run-card__icon--download{background:var(--run-download-soft);color:var(--run-download);border:1px solid var(--run-download-border)}
.run-card__icon--repair{background:var(--run-repair-soft);color:var(--run-repair);border:1px solid var(--run-repair-border)}
.run-card__icon--initialization{background:var(--run-sync-soft);color:var(--run-sync);border:1px solid var(--run-sync-border)}
.run-card__body{min-width:0}
.run-card__meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1_5)}
.run-card__body h3{margin:var(--space-1) 0 0;overflow:hidden;color:var(--text-primary);font-size:var(--text-sm);font-weight:var(--font-weight-bold);line-height:1.3;text-overflow:ellipsis;white-space:nowrap}
.run-card__trigger{margin-left:.1rem;font-size:var(--text-xs);color:var(--text-tertiary)}
.run-card__time{display:flex;flex-direction:column;align-items:flex-end;flex:none;font-size:var(--text-xs);color:var(--text-secondary)}
.run-card__time small{margin-top:var(--space-1);color:var(--text-tertiary)}
.run-card__details{display:grid;grid-template-columns:minmax(9rem,.8fr) minmax(13rem,1.2fr);align-items:center;gap:var(--space-4);min-width:0;font-size:var(--text-xs);color:var(--text-secondary)}
.run-card__source-column,.run-card__results{display:flex;min-width:0;align-items:center;gap:var(--space-2)}
.run-card__column-label{flex:none;color:var(--text-tertiary);font-size:var(--text-xs)}
.run-card__source{display:inline-flex;min-width:0;align-items:center;gap:var(--space-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.run-card__total{flex:none;padding-right:var(--space-2);border-right:1px solid var(--border-primary);white-space:nowrap}
.run-card__result{display:inline-flex;align-items:center;gap:var(--space-1);font-weight:var(--font-weight-semibold);white-space:nowrap}
.run-card__result>span{width:.35rem;height:.35rem;border-radius:var(--radius-full);background:currentColor}
.run-card__chevron{color:var(--text-tertiary)}
@media(max-width:1280px){.run-card{grid-template-columns:auto minmax(0,1fr) auto auto}.run-card__details{grid-column:2;grid-template-columns:minmax(9rem,.8fr) minmax(13rem,1.2fr)}.run-card__time{grid-column:3;grid-row:1 / span 2}.run-card__chevron{grid-column:4;grid-row:1 / span 2}}
@media(max-width:720px){.run-card{grid-template-columns:auto minmax(0,1fr) auto;padding:var(--space-3)}.run-card__details{grid-column:2 / -1;grid-template-columns:1fr;gap:var(--space-1_5)}.run-card__time{grid-column:2;grid-row:auto;align-items:flex-start;flex-direction:row;gap:var(--space-2)}.run-card__time small{margin:0}.run-card__chevron{grid-column:3;grid-row:1}.run-card__results{flex-wrap:wrap}}
@media(max-width:480px){.run-card__source-column{align-items:flex-start;flex-direction:column;gap:var(--space-1)}.run-card__column-label{display:none}.run-card__chevron{display:none}}
@media(prefers-reduced-motion:reduce){.run-card{transition:none}.run-card:hover{transform:none}}
</style>
