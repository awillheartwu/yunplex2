<template>
  <button
    class="w-full text-left section-card p-5 hover:border-[var(--border-secondary)] hover:[background-color:var(--bg-elevated)] cursor-pointer group transition-all duration-150"
    @click="$emit('select')"
  >
    <div class="flex items-start justify-between gap-4">
      <!-- Status icon -->
      <div class="shrink-0 mt-0.5">
        <div
          class="w-9 h-9 rounded-lg flex items-center justify-center"
          :class="`job-card__type-icon--${typeIdentity.tone}`"
        >
          <AppIcon :name="typeIdentity.icon" :size="18" />
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <RunTypeBadge :type="job.type" compact size="sm" />
          <StatusBadge :status="badgeStatus" :label="runStatusLabel(job.status)" size="sm" />
          <span v-if="job.dryRun" class="job-card__preview">预览</span>
        </div>
        <p class="text-sm text-muted mb-2">{{ job.summary }}</p>
        <div class="flex items-center gap-x-3 gap-y-0.5 text-2xs flex-wrap" style="color:var(--text-tertiary)">
          <span>{{ formatDuration(job.durationMs) }}</span>
          <span style="color:var(--text-tertiary)">·</span>
          <span>{{ job.totalSongs }} 首已处理</span>
          <span v-if="job.successSongs > 0" class="text-success">{{ job.successSongs }} 已成功</span>
          <span v-if="job.skippedSongs > 0" class="text-existing">{{ job.skippedSongs }} 已存在</span>
          <span v-if="job.warnings > 0" class="text-ignored">{{ job.warnings }} 已忽略</span>
          <span v-if="job.removedSongs > 0" class="text-warning">{{ job.removedSongs }} 已移除</span>
          <span v-if="job.failedSongs > 0" class="text-danger">{{ job.failedSongs }} 下载失败</span>
        </div>
      </div>

      <!-- Time -->
      <div class="shrink-0 text-right">
        <p class="text-2xs text-muted-deep">{{ formatTime(job.startedAt) }}</p>
        <AppIcon name="chevronRight" :size="14" class="ml-auto mt-1 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  </button>
</template>

<script setup lang="ts">
import type { TaskRunSummary } from '~~/server/lib/job/types'
import {
  runBadgeStatus,
  runStatusLabel,
  runTypeIdentity,
} from '~~/lib/run-presentation'

const props = defineProps<{ job: TaskRunSummary }>()
defineEmits<{ select: [] }>()

const typeIdentity = computed(() => runTypeIdentity(props.job.type))
const badgeStatus = computed(() => runBadgeStatus(props.job.status))

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.job-card__type-icon--sync{color:var(--run-sync);background:var(--run-sync-soft);border:1px solid var(--run-sync-border)}
.job-card__type-icon--repair{color:var(--run-repair);background:var(--run-repair-soft);border:1px solid var(--run-repair-border)}
.job-card__preview{display:inline-flex;align-items:center;padding:.15rem .45rem;border:1px solid var(--ignored-border);border-radius:.4rem;background:var(--ignored-soft);color:var(--ignored);font-size:.68rem;font-weight:700}
</style>
