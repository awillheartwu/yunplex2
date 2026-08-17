<template>
  <NuxtLink
    :to="`/task-center/runs/${run.id}`"
    class="run-card"
    :aria-label="`查看${runTypeLabel(run.type)}运行：${runSummaryLabel(run.summary)}`"
  >
    <div class="run-card__icon" :class="`run-card__icon--${typeTone}`">
      <AppIcon :name="runTypeIcon(run.type)" :size="18" />
    </div>
    <div class="run-card__body">
      <div class="run-card__meta">
        <RunTypeBadge :type="run.type" compact size="sm" />
        <StatusBadge :status="badgeStatus" :label="runStatusLabel(run.status)" size="sm" />
        <span class="run-card__trigger">{{ runTriggerLabel(run.trigger) }}</span>
      </div>
      <h3>{{ runSummaryLabel(run.summary, `${runTypeLabel(run.type)}运行`) }}</h3>
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
      <small>{{ run.status === 'running' ? '仍在运行' : formatRunDuration(run.durationMs) }}</small>
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
const badgeStatus = computed(() => runBadgeStatus(props.run.status))
const visibleResults = computed(() => runResultItems(props.run as TaskRunSummary & { warnings: number }).filter(item => item.count > 0))
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.run-card{display:grid;grid-template-columns:auto minmax(17rem,1.15fr) minmax(24rem,1.5fr) minmax(7rem,auto) auto;gap:1rem;align-items:center;position:relative;padding:.72rem 1rem;border:1px solid var(--border-primary);border-bottom:0;background:var(--bg-surface);text-decoration:none;color:inherit;transition:border-color 160ms ease,background 160ms ease,box-shadow 160ms ease,transform 160ms ease}
.run-card:first-child{border-radius:var(--radius-xl) var(--radius-xl) 0 0}
.run-card:last-child{border-bottom:1px solid var(--border-primary);border-radius:0 0 var(--radius-xl) var(--radius-xl)}
.run-card:only-child{border-radius:var(--radius-xl)}
.run-card:hover{z-index:1;border-color:var(--border-secondary);background:var(--bg-elevated);box-shadow:var(--shadow-sm);transform:translateX(2px)}
.run-card:focus-visible{z-index:2;outline:2px solid var(--accent);outline-offset:2px}
.run-card__icon{display:flex;width:2.25rem;height:2.25rem;align-items:center;justify-content:center;border-radius:.68rem;background:var(--bg-input);color:var(--text-secondary)}
.run-card__icon--sync{background:var(--run-sync-soft);color:var(--run-sync);border:1px solid var(--run-sync-border)}
.run-card__icon--download{background:var(--run-download-soft);color:var(--run-download);border:1px solid var(--run-download-border)}
.run-card__icon--repair{background:var(--run-repair-soft);color:var(--run-repair);border:1px solid var(--run-repair-border)}
.run-card__body{min-width:0}
.run-card__meta{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem}
.run-card__body h3{margin:.3rem 0 0;overflow:hidden;color:var(--text-primary);font-size:.84rem;font-weight:700;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}
.run-card__trigger{margin-left:.1rem;font-size:.68rem;color:var(--text-tertiary)}
.run-card__time{display:flex;flex-direction:column;align-items:flex-end;flex:none;font-size:.75rem;color:var(--text-secondary)}
.run-card__time small{margin-top:.2rem;color:var(--text-tertiary)}
.run-card__details{display:grid;grid-template-columns:minmax(9rem,.8fr) minmax(13rem,1.2fr);align-items:center;gap:1rem;min-width:0;font-size:.7rem;color:var(--text-secondary)}
.run-card__source-column,.run-card__results{display:flex;min-width:0;align-items:center;gap:.45rem}
.run-card__column-label{flex:none;color:var(--text-tertiary);font-size:.64rem}
.run-card__source{display:inline-flex;min-width:0;align-items:center;gap:.25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.run-card__total{flex:none;padding-right:.55rem;border-right:1px solid var(--border-primary);white-space:nowrap}
.run-card__result{display:inline-flex;align-items:center;gap:.28rem;font-weight:650;white-space:nowrap}
.run-card__result>span{width:.35rem;height:.35rem;border-radius:999px;background:currentColor}
.run-card__chevron{color:var(--text-tertiary)}
@media(max-width:1280px){.run-card{grid-template-columns:auto minmax(0,1fr) auto auto}.run-card__details{grid-column:2;grid-template-columns:minmax(9rem,.8fr) minmax(13rem,1.2fr)}.run-card__time{grid-column:3;grid-row:1 / span 2}.run-card__chevron{grid-column:4;grid-row:1 / span 2}}
@media(max-width:720px){.run-card{grid-template-columns:auto minmax(0,1fr) auto;padding:.8rem}.run-card__details{grid-column:2 / -1;grid-template-columns:1fr;gap:.4rem}.run-card__time{grid-column:2;grid-row:auto;align-items:flex-start;flex-direction:row;gap:.5rem}.run-card__time small{margin:0}.run-card__chevron{grid-column:3;grid-row:1}.run-card__results{flex-wrap:wrap}}
@media(max-width:480px){.run-card__source-column{align-items:flex-start;flex-direction:column;gap:.2rem}.run-card__column-label{display:none}.run-card__chevron{display:none}}
@media(prefers-reduced-motion:reduce){.run-card{transition:none}.run-card:hover{transform:none}}
</style>
