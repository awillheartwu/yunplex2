<template>
  <NuxtLink :to="`/task-center/runs/${run.id}`" class="run-card section-card">
    <div class="run-card__icon" :class="`run-card__icon--${typeTone}`">
      <AppIcon :name="runTypeIcon(run.type)" :size="18" />
    </div>
    <div class="run-card__body">
      <div class="run-card__heading">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <RunTypeBadge :type="run.type" compact size="sm" />
            <StatusBadge :status="badgeStatus" :label="runStatusLabel(run.status)" size="sm" />
            <span class="run-card__trigger">{{ runTriggerLabel(run.trigger) }}</span>
          </div>
          <h3>{{ run.summary || `${runTypeLabel(run.type)}运行` }}</h3>
        </div>
        <div class="run-card__time">
          <span>{{ formatTime(run.startedAt) }}</span>
          <small>{{ run.status === 'running' ? '仍在运行' : formatRunDuration(run.durationMs) }}</small>
        </div>
      </div>
      <div class="run-card__stats" aria-label="运行结果">
        <span>{{ run.totalSongs }} 项</span>
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
    <AppIcon name="chevronRight" :size="16" class="run-card__chevron" />
  </NuxtLink>
</template>

<script setup lang="ts">
import type { TaskRunSummary } from '~~/server/lib/job/types'
import {
  formatRunDuration,
  runBadgeStatus,
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
.run-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:1rem;align-items:center;padding:1.1rem 1.2rem;text-decoration:none;color:inherit;transition:border-color 160ms ease,background 160ms ease,box-shadow 160ms ease}
.run-card:hover{border-color:var(--border-secondary);background:var(--bg-elevated);box-shadow:var(--shadow-sm)}
.run-card__icon{display:flex;width:2.6rem;height:2.6rem;align-items:center;justify-content:center;border-radius:.85rem;background:var(--bg-input);color:var(--text-secondary)}
.run-card__icon--sync{background:var(--run-sync-soft);color:var(--run-sync);border:1px solid var(--run-sync-border)}
.run-card__icon--download{background:var(--run-download-soft);color:var(--run-download);border:1px solid var(--run-download-border)}
.run-card__icon--repair{background:var(--run-repair-soft);color:var(--run-repair);border:1px solid var(--run-repair-border)}
.run-card__heading{display:flex;justify-content:space-between;gap:1rem}
.run-card__heading h3{margin:.4rem 0 0;font-size:.92rem;color:var(--text-primary)}
.run-card__trigger{font-size:.72rem;color:var(--text-tertiary)}
.run-card__time{display:flex;flex-direction:column;align-items:flex-end;flex:none;font-size:.75rem;color:var(--text-secondary)}
.run-card__time small{margin-top:.2rem;color:var(--text-tertiary)}
.run-card__stats{display:flex;flex-wrap:wrap;gap:.35rem .9rem;margin-top:.65rem;font-size:.75rem;color:var(--text-secondary)}
.run-card__result{display:inline-flex;align-items:center;gap:.3rem;padding:.1rem .42rem;border:1px solid;border-radius:999px;font-weight:650}
.run-card__result>span{width:.35rem;height:.35rem;border-radius:999px;background:currentColor}
.run-card__chevron{color:var(--text-tertiary)}
@media(max-width:640px){.run-card{grid-template-columns:auto minmax(0,1fr);padding:1rem}.run-card__heading{display:block}.run-card__time{align-items:flex-start;margin-top:.5rem}.run-card__chevron{display:none}}
</style>
