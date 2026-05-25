<template>
  <button
    class="w-full text-left section-card p-5 hover:border-[var(--border-secondary)] hover:bg-surface-elevated transition-all cursor-pointer group"
    @click="$emit('select')"
  >
    <div class="flex items-start justify-between gap-4">
      <!-- Status icon -->
      <div class="shrink-0 mt-0.5">
        <div
          class="w-9 h-9 rounded-lg flex items-center justify-center"
          :class="statusBg"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <template v-if="job.status === 'success'">
              <path d="M3 8l3.5 3.5L13 5" :stroke="statusColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </template>
            <template v-else-if="job.status === 'partial'">
              <path d="M8 6v3M8 11v0M1.5 13.5h13L8 2.5 1.5 13.5z" :stroke="statusColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            </template>
            <template v-else-if="job.status === 'failed'">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" :stroke="statusColor" stroke-width="1.5" stroke-linecap="round" />
            </template>
            <template v-else-if="job.status === 'running'">
              <circle cx="8" cy="8" r="6" :stroke="statusColor" stroke-width="1.3" stroke-dasharray="8 4" class="animate-[spin_2s_linear_infinite]" />
            </template>
            <template v-else>
              <circle cx="8" cy="8" r="5.5" :stroke="statusColor" stroke-width="1.3" />
              <path d="M5.5 8h5" :stroke="statusColor" stroke-width="1.3" stroke-linecap="round" />
            </template>
          </svg>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-sm font-semibold text-[var(--text-primary)]">
            {{ statusLabel }}
          </span>
          <span v-if="job.dryRun" class="px-1.5 py-0.5 text-2xs rounded bg-[#f1c40f18] text-warning font-medium">预览</span>
        </div>
        <p class="text-sm text-muted mb-2">{{ job.summary }}</p>
        <div class="flex items-center gap-4 text-2xs text-muted-deep">
          <span>{{ formatDuration(job.durationMs) }}</span>
          <span v-if="job.successSongs > 0" class="text-success">+{{ job.successSongs }}</span>
          <span v-if="job.failedSongs > 0" class="text-danger">{{ job.failedSongs }} 失败</span>
          <span v-if="job.skippedSongs > 0">{{ job.skippedSongs }} 跳过</span>
        </div>
      </div>

      <!-- Time -->
      <div class="shrink-0 text-right">
        <p class="text-2xs text-muted-deep">{{ formatTime(job.startedAt) }}</p>
        <svg class="ml-auto mt-1 opacity-0 group-hover:opacity-100 transition-opacity" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M6 3l5 5-5 5" stroke="#6b6b6b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </div>
  </button>
</template>

<script setup lang="ts">
import type { JobSummary } from '~~/server/lib/job/types'

const props = defineProps<{ job: JobSummary }>()
defineEmits<{ select: [] }>()

const statusConfig = computed(() => {
  switch (props.job.status) {
    case 'success': return { bg: 'bg-[#2ecc7120]', color: '#2ecc71', label: '同步成功' }
    case 'partial': return { bg: 'bg-[#f1c40f20]', color: '#f1c40f', label: '部分成功' }
    case 'failed': return { bg: 'bg-[#e74c3c20]', color: '#e74c3c', label: '同步失败' }
    case 'running': return { bg: 'bg-accent-muted', color: '#5e6ad2', label: '同步中' }
    case 'cancelled': return { bg: 'bg-[#6b6b6b20]', color: '#6b6b6b', label: '已取消' }
  }
})

const statusLabel = computed(() => statusConfig.value.label)
const statusColor = computed(() => statusConfig.value.color)
const statusBg = computed(() => statusConfig.value.bg)

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
