<template>
  <div class="space-y-8">
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
    <div class="grid grid-cols-6 gap-3">
      <div class="rounded-lg p-3 text-center" style="background:var(--bg-surface);border:1px solid var(--border-primary)">
        <p class="text-lg font-semibold text-[var(--text-primary)]">{{ job.totalSongs }}</p>
        <p class="text-2xs text-muted-deep">已处理</p>
      </div>
      <div class="rounded-lg p-3 text-center" style="background:var(--bg-surface);border:1px solid var(--border-primary)">
        <p class="text-lg font-semibold text-[var(--text-primary)]">{{ playlistTotalSongs }}</p>
        <p class="text-2xs text-muted-deep">监控总曲目</p>
      </div>
      <div class="rounded-lg p-3 text-center" style="background:var(--bg-surface);border:1px solid var(--border-primary)">
        <p class="text-lg font-semibold text-success">{{ job.successSongs }}</p>
        <p class="text-2xs text-muted-deep">下载成功</p>
      </div>
      <div class="rounded-lg p-3 text-center" style="background:var(--bg-surface);border:1px solid var(--border-primary)">
        <p class="text-lg font-semibold text-muted">{{ job.skippedSongs }}</p>
        <p class="text-2xs text-muted-deep">已存在</p>
      </div>
      <div class="rounded-lg p-3 text-center" style="background:var(--bg-surface);border:1px solid var(--border-primary)">
        <p class="text-lg font-semibold text-warning">{{ job.removedSongs }}</p>
        <p class="text-2xs text-muted-deep">已移除</p>
      </div>
      <div class="rounded-lg p-3 text-center" style="background:var(--bg-surface);border:1px solid var(--border-primary)">
        <p class="text-lg font-semibold text-danger">{{ job.failedSongs }}</p>
        <p class="text-2xs text-muted-deep">失败</p>
      </div>
    </div>

    <!-- Timeline -->
    <section class="section-card overflow-hidden">
      <div class="px-5 py-3 border-b border-[var(--border-primary)]">
        <h3 class="text-sm font-semibold">执行时间线</h3>
      </div>
      <div class="p-5">
        <JobTimeline :steps="job.steps" />
      </div>
    </section>

    <!-- Song results grouped by source -->
    <section v-if="job.songs.length > 0" class="section-card overflow-hidden">
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

      <template v-if="songGroups.length === 0">
        <div class="divide-y divide-[var(--border-primary)]">
          <SongRow
            v-for="song in filteredSongs"
            :key="song.id"
            :song="song"
            :expanded="expandedSong === song.id"
            @toggle="expandedSong = expandedSong === song.id ? null : song.id"
          />
        </div>
      </template>

      <template v-else>
        <div v-for="group in songGroups" :key="group.sourceId">
          <button
            class="w-full px-5 py-2.5 border-b border-[var(--border-primary)] bg-[var(--bg-app)] flex items-center gap-3 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors text-left"
            @click="toggleGroup(group.sourceId)"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" class="transition-transform shrink-0" :class="collapsedGroups.has(group.sourceId) ? '' : 'rotate-90'">
              <path d="M6 3l5 5-5 5" stroke="#9d9d9d" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="4" r="2.5" stroke="#9d9d9d" stroke-width="1.3"/><path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="#9d9d9d" stroke-width="1.3" stroke-linecap="round"/></svg>
            <span class="text-xs font-medium flex-1">{{ group.sourceName }}</span>
            <span class="text-2xs text-muted">{{ group.stats }}</span>
          </button>
          <div v-if="!collapsedGroups.has(group.sourceId)" class="divide-y divide-[var(--border-primary)]">
            <SongRow
              v-for="song in group.songs"
              :key="song.id"
              :song="song"
              :expanded="expandedSong === song.id"
              @toggle="expandedSong = expandedSong === song.id ? null : song.id"
            />
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { SyncJob, SongStatus, SongTask } from '~~/server/lib/job/types'

const props = defineProps<{ job: SyncJob }>()
defineEmits<{ back: [] }>()

const api = useApi()
const expandedSong = ref<string | null>(null)
const songFilter = ref<SongStatus | ''>('')
const sourceNameMap = ref<Record<string, string>>({})
const playlistTotalSongs = ref(0)
const collapsedGroups = reactive(new Set<string>())

function toggleGroup(sourceId: string) {
  if (collapsedGroups.has(sourceId)) collapsedGroups.delete(sourceId)
  else collapsedGroups.add(sourceId)
}

interface SongGroup {
  sourceId: string
  sourceName: string
  stats: string
  songs: SongTask[]
}

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
  { label: '已移除', value: 'removed' },
]

function applyFilter(songs: SongTask[]): SongTask[] {
  if (!songFilter.value) return songs
  if (songFilter.value === 'failed_download') {
    return songs.filter((s) =>
      ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status),
    )
  }
  return songs.filter((s) => s.status === songFilter.value)
}

const filteredSongs = computed(() => applyFilter(props.job.songs))

const songGroups = computed<SongGroup[]>(() => {
  const hasSourceIds = props.job.songs.some((s) => s.sourceId)
  if (!hasSourceIds) return []

  const groups = new Map<string, SongTask[]>()
  for (const s of props.job.songs) {
    const key = s.sourceId || '__unknown__'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }

  return Array.from(groups.entries()).map(([sourceId, songs]) => {
    const filtered = applyFilter(songs)
    const name = sourceNameMap.value[sourceId] || sourceId.slice(0, 8)
    const succ = filtered.filter((s) => s.status === 'success').length
    const fail = filtered.filter((s) => ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status)).length
    const skip = filtered.filter((s) => s.status === 'skipped_existing').length
    const rm = filtered.filter((s) => s.status === 'removed').length
    const parts = [`${filtered.length} 首`]
    if (succ) parts.push(`${succ} 成功`)
    if (fail) parts.push(`${fail} 失败`)
    if (skip) parts.push(`${skip} 已存在`)
    if (rm) parts.push(`${rm} 移除`)
    return { sourceId, sourceName: name, stats: parts.join(' · '), songs: filtered }
  }).filter((g) => g.songs.length > 0)
})

async function fetchSourceNames() {
  try {
    const sources = await api.get<Array<{ id: string; name: string; trackCount: number; enabled: boolean }>>('/playlist-sources')
    for (const s of sources) {
      sourceNameMap.value[s.id] = s.name
    }
    playlistTotalSongs.value = sources
      .filter(s => s.enabled)
      .reduce((sum, s) => sum + (s.trackCount || 0), 0)
  } catch { /* ignore */ }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

onMounted(fetchSourceNames)
</script>
