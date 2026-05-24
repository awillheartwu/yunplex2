<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <button class="flex items-center gap-2 text-sm text-muted hover:text-[var(--text-primary)] transition-colors" @click="$emit('back')">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        返回任务列表
      </button>
      <span class="text-2xs text-muted-deep font-mono">ID: {{ job.id }}</span>
    </div>

    <!-- Summary bar -->
    <div class="flex items-center gap-4 flex-wrap">
      <StatusBadge :status="badgeStatus" />
      <span class="text-sm text-muted">{{ job.summary }}</span>
      <span class="text-2xs text-muted-deep">{{ formatDuration(job.durationMs) }}</span>
      <span class="text-2xs text-muted-deep">{{ formatTime(job.startedAt) }}</span>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-5 gap-3">
      <div class="bg-surface border border-[var(--border-primary)] rounded-lg p-3 text-center">
        <p class="text-lg font-semibold text-[var(--text-primary)]">{{ job.totalSongs }}</p>
        <p class="text-2xs text-muted-deep">总计</p>
      </div>
      <div class="bg-surface border border-[var(--border-primary)] rounded-lg p-3 text-center">
        <p class="text-lg font-semibold text-success">{{ job.successSongs }}</p>
        <p class="text-2xs text-muted-deep">成功</p>
      </div>
      <div class="bg-surface border border-[var(--border-primary)] rounded-lg p-3 text-center">
        <p class="text-lg font-semibold text-danger">{{ job.failedSongs }}</p>
        <p class="text-2xs text-muted-deep">失败</p>
      </div>
      <div class="bg-surface border border-[var(--border-primary)] rounded-lg p-3 text-center">
        <p class="text-lg font-semibold text-muted">{{ job.skippedSongs }}</p>
        <p class="text-2xs text-muted-deep">已存在</p>
      </div>
      <div class="bg-surface border border-[var(--border-primary)] rounded-lg p-3 text-center">
        <p class="text-lg font-semibold text-muted">{{ job.warnings }}</p>
        <p class="text-2xs text-muted-deep">警告</p>
      </div>
    </div>

    <!-- Timeline -->
    <section class="bg-surface border border-[var(--border-primary)] rounded-xl overflow-hidden">
      <div class="px-5 py-3 border-b border-[var(--border-primary)]">
        <h3 class="text-sm font-semibold">执行时间线</h3>
      </div>
      <div class="p-5">
        <JobTimeline :steps="job.steps" />
      </div>
    </section>

    <!-- Song results -->
    <section v-if="job.songs.length > 0" class="bg-surface border border-[var(--border-primary)] rounded-xl overflow-hidden">
      <div class="px-5 py-3 border-b border-[var(--border-primary)] flex items-center justify-between">
        <h3 class="text-sm font-semibold">歌曲清单</h3>
        <div class="flex items-center gap-2">
          <button
            v-for="f in songFilters"
            :key="f.value"
            class="text-2xs px-2 py-1 rounded transition-colors"
            :class="songFilter === f.value ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]' : 'text-muted hover:text-[var(--text-primary)]'"
            @click="songFilter = f.value"
          >{{ f.label }}</button>
        </div>
      </div>
      <div class="divide-y divide-[var(--border-primary)]">
        <SongRow
          v-for="song in filteredSongs"
          :key="song.id"
          :song="song"
          :expanded="expandedSong === song.id"
          @toggle="expandedSong = expandedSong === song.id ? null : song.id"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { SyncJob, SongStatus } from '~~/server/lib/job/types'

const props = defineProps<{ job: SyncJob }>()
defineEmits<{ back: [] }>()

const expandedSong = ref<string | null>(null)
const songFilter = ref<SongStatus | ''>('')

const badgeStatus = computed<'ok' | 'error' | 'warning' | 'running' | 'idle'>(() => {
  switch (props.job.status) {
    case 'success': return 'ok'
    case 'partial': return 'warning'
    case 'failed': return 'error'
    case 'running': return 'running'
    case 'cancelled': return 'idle'
  }
})

const songFilters = [
  { label: '全部', value: '' },
  { label: '成功', value: 'success' },
  { label: '失败', value: 'failed_download' },
  { label: '已存在', value: 'skipped_existing' },
]

const filteredSongs = computed(() => {
  if (!songFilter.value) return props.job.songs
  if (songFilter.value === 'failed_download') {
    return props.job.songs.filter((s) =>
      ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status),
    )
  }
  return props.job.songs.filter((s) => s.status === songFilter.value)
})

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>
