<template>
  <div class="run-detail">
    <div class="run-detail__nav">
      <button class="run-detail__back" type="button" @click="$emit('back')">
        <AppIcon name="chevronLeft" :size="14" />
        返回运行记录
      </button>
      <span class="run-detail__id">ID: {{ job.id }}</span>
    </div>

    <section class="section-card run-detail__hero" :class="`run-detail__hero--${typeIdentity.tone}`">
      <div class="run-detail__hero-icon" aria-hidden="true">
        <AppIcon :name="typeIdentity.icon" :size="24" />
      </div>
      <div class="run-detail__hero-copy">
        <div class="run-detail__hero-labels">
          <RunTypeBadge :type="job.type" />
          <StatusBadge :status="badgeStatus" :label="runStatusLabel(job.status)" />
          <span v-if="job.dryRun" class="run-detail__preview">预览运行</span>
        </div>
        <h2>{{ runSummaryLabel(job.summary, typeIdentity.description) }}</h2>
        <p>{{ typeIdentity.description }}</p>
        <div class="run-detail__hero-meta">
          <span><AppIcon name="calendar" :size="13" />{{ formatTime(job.startedAt) }}</span>
          <span><AppIcon name="clock" :size="13" />{{ formatRunDuration(job.durationMs) }}</span>
          <span><AppIcon name="play" :size="13" />{{ runTriggerLabel(job.trigger) }}</span>
        </div>
      </div>
    </section>

    <section class="run-detail__stats" aria-label="运行结果统计">
      <div v-if="job.type !== 'manual_download'" class="run-stat semantic-neutral">
        <AppIcon name="list" :size="16" />
        <p>{{ job.totalSongs }}</p>
        <span>已处理</span>
      </div>
      <div v-if="job.type !== 'manual_download'" class="run-stat semantic-neutral">
        <AppIcon name="music" :size="16" />
        <p>{{ playlistTotalSongs }}</p>
        <span>监控总曲目</span>
      </div>
      <div
        v-for="item in resultItems"
        :key="item.key"
        class="run-stat"
        :class="semanticToneClass(item.tone)"
      >
        <AppIcon :name="item.icon" :size="16" />
        <p>{{ item.count }}</p>
        <span>{{ item.label }}</span>
      </div>
    </section>

    <section v-if="job.detailsExpired" class="section-card run-detail__expired" role="status">
      <AppIcon name="archive" :size="18" />
      <div>
        <strong>变化明细已按保留策略清理</strong>
        <p>运行摘要和统计仍然保留；需要继续处理的问题请前往任务中心的异常处理。</p>
      </div>
      <NuxtLink to="/task-center?tab=failures" class="btn btn-secondary btn-xs">查看异常</NuxtLink>
    </section>

    <section v-if="mediaPolicyItems.length > 0" class="section-card p-4" aria-label="缺失媒体策略统计">
      <div class="mb-3">
        <h3 class="text-sm font-semibold">缺失媒体策略</h3>
        <p class="mt-1 text-2xs text-muted">按已登记资产和人工决定统计本轮处理路径</p>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div
          v-for="item in mediaPolicyItems"
          :key="item.key"
          class="rounded-lg border px-3 py-2"
          style="border-color:var(--border-primary);background:var(--bg-app)"
        >
          <p class="text-base font-bold">{{ item.count }}</p>
          <span class="text-2xs text-muted">{{ item.label }}</span>
        </div>
      </div>
    </section>

    <section v-if="!job.detailsExpired" class="section-card overflow-hidden">
      <button
        type="button"
        class="run-detail__section-toggle"
        :class="timelineCollapsed ? 'border-b-transparent' : ''"
        :aria-expanded="!timelineCollapsed"
        @click="timelineCollapsed = !timelineCollapsed"
      >
        <span>
          <strong>执行时间线</strong>
          <small>按过程聚合关键结果</small>
        </span>
        <AppIcon name="chevronRight" :size="12" class="shrink-0 transition-transform" :class="timelineCollapsed ? '' : 'rotate-90'" />
      </button>
      <div v-show="!timelineCollapsed" class="run-detail__timeline">
        <JobTimeline :items="timelineItems" />
      </div>
    </section>

    <section
      v-if="!job.detailsExpired && job.status !== 'running' && job.songs.length === 0"
      class="section-card p-4 text-sm text-muted"
      role="status"
    >
      本次运行没有需要记录的歌曲变化或异常；未变化歌曲只计入上方统计。
    </section>

    <!-- Changed and exceptional song results grouped by source -->
    <section v-if="!job.detailsExpired && job.songs.length > 0" class="section-card overflow-hidden">
      <div class="run-detail__song-toolbar">
        <div class="run-detail__song-title">
          <h3>变化与异常</h3>
          <button
            type="button"
            class="run-detail__collapse-all"
            :disabled="songGroups.length === 0"
            title="全部折叠"
            aria-label="全部折叠歌曲来源"
            @click="collapseAllGroups"
          >
            <AppIcon name="listCollapse" :size="15" />
          </button>
        </div>
        <div class="run-detail__song-filters" aria-label="按歌曲状态筛选">
          <button
            v-for="f in songFilters"
            :key="f.key"
            type="button"
            class="run-detail__song-filter"
            :class="[semanticToneClass(f.tone), { 'is-active': songFilter === f.key }]"
            :aria-pressed="songFilter === f.key"
            @click="songFilter = f.key"
          >
            <AppIcon :name="f.icon" :size="12" />
            <span>{{ f.label }}</span>
            <strong>{{ f.count }}</strong>
          </button>
        </div>
      </div>

      <template v-if="songGroups.length === 0">
        <div class="divide-y divide-[var(--border-primary)]">
          <SongRow
            v-for="song in filteredSongs"
            :key="song.id"
            :song="song"
            :expanded="expandedSong === song.id"
            :retrying="retryingSongs.has(song.id)"
            :retry-progress="retryProgress[song.id] || 0"
            @toggle="expandedSong = expandedSong === song.id ? null : song.id"
            @retry="handleRetry(song)"
          />
        </div>
      </template>

      <template v-else>
        <div v-for="group in songGroups" :key="group.sourceId">
          <div class="run-detail__song-group">
            <button class="run-detail__song-group-toggle" type="button" :aria-expanded="!collapsedGroups.has(group.sourceId)" @click="toggleGroup(group.sourceId)">
              <AppIcon name="chevronRight" :size="12" class="transition-transform shrink-0" :class="collapsedGroups.has(group.sourceId) ? '' : 'rotate-90'" />
              <AppIcon name="source" :size="12" class="text-muted-deep" />
              <SourceBadge :type="(sourceTypeMap[group.sourceId] as 'playlist' | 'album') || 'playlist'" :subscribed="sourceSubscribedMap[group.sourceId]" />
              <span class="run-detail__song-group-name">{{ group.sourceName }}</span>
              <span class="run-detail__song-group-stats" aria-label="来源内歌曲状态统计">
                <span
                  v-for="stat in group.stats"
                  :key="stat.key"
                  class="run-detail__song-group-stat"
                  :class="semanticToneClass(stat.tone)"
                >
                  <AppIcon :name="stat.icon" :size="10" />
                  {{ stat.count }} {{ stat.label }}
                </span>
              </span>
            </button>
            <button
              v-if="hasFailedSongs(group)"
              class="run-detail__retry-source"
              :class="retryingSources.has(group.sourceId) ? 'text-muted-deep cursor-not-allowed' : 'text-accent hover:bg-[var(--accent-muted)]'"
              :disabled="retryingSources.has(group.sourceId)"
              @click.stop="handleRetryAll(group.sourceId)"
            >{{ retryingSources.has(group.sourceId) ? '同步中...' : '重试全部失败' }}</button>
          </div>
          <div v-if="!collapsedGroups.has(group.sourceId)" class="divide-y divide-[var(--border-primary)]">
            <SongRow
              v-for="song in group.songs"
              :key="song.id"
              :song="song"
              :expanded="expandedSong === song.id"
              :retrying="retryingSongs.has(song.id)"
              :retry-progress="retryProgress[song.id] || 0"
              @toggle="expandedSong = expandedSong === song.id ? null : song.id"
              @retry="handleRetry(song)"
            />
          </div>
        </div>
      </template>

      <div v-if="filteredSongCount > renderLimit" class="p-4 border-t border-[var(--border-primary)] text-center">
        <button class="btn btn-secondary btn-sm" type="button" @click="renderLimit += 100">
          显示更多（{{ Math.min(renderLimit, filteredSongCount) }} / {{ filteredSongCount }}）
        </button>
      </div>
    </section>

    <!-- Repair task: no per-song details -->
    <section v-else-if="!job.detailsExpired && job.type === 'repair'" class="section-card overflow-hidden">
      <div class="px-5 py-3 border-b border-[var(--border-primary)]">
        <h3 class="text-sm font-semibold">歌曲清单</h3>
      </div>
      <div class="p-5">
        <p class="text-xs text-muted">补全任务不记录单首歌曲详情，请查看上方统计数字或日志页。</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { TaskRun, SongTask } from '~~/server/lib/job/types'
import { sseSubscribe } from '~~/composables/sse'
import {
  formatRunDuration,
  runBadgeStatus,
  runSummaryLabel,
  runStatusLabel,
  runTriggerLabel,
  runTypeIdentity,
} from '~~/lib/run-presentation'
import { buildRunTimeline } from '~~/lib/run-timeline'
import {
  isFailedSongStatus,
  runResultItems,
  semanticToneClass,
  SONG_STATUS_BUCKETS,
  songMatchesStatusBucket,
  songStatusBucketCount,
  type SongStatusBucket,
  type TaskSemanticTone,
} from '~~/lib/task-status'

const props = defineProps<{ job: TaskRun }>()
defineEmits<{ back: [] }>()

const api = useApi()
const expandedSong = ref<string | null>(null)
const retryingSongs = ref<Set<string>>(new Set())
const retryingSources = ref<Set<string>>(new Set())
const retryProgress = ref<Record<string, number>>({})

function hasFailedSongs(group: SongGroup): boolean {
  return group.songs.some((song) => isFailedSongStatus(song.status)
    || ['copyright_restricted', 'ignored_failure'].includes(song.status))
}
const songFilter = ref<SongStatusBucket>('all')
const sourceNameMap = ref<Record<string, string>>({})
const sourceTypeMap = ref<Record<string, string>>({})
const sourceSubscribedMap = ref<Record<string, boolean>>({})
const playlistTotalSongs = ref(0)
const timelineCollapsed = ref(false)
const collapsedGroups = reactive(new Set<string>())
const renderLimit = ref(100)

function toggleGroup(sourceId: string) {
  if (collapsedGroups.has(sourceId)) collapsedGroups.delete(sourceId)
  else collapsedGroups.add(sourceId)
}
function collapseAllGroups() {
  for (const g of songGroups.value) {
    collapsedGroups.add(g.sourceId)
  }
}

interface SongGroup {
  sourceId: string
  sourceName: string
  stats: SongGroupStat[]
  songs: SongTask[]
}

interface SongGroupStat {
  key: SongStatusBucket
  label: string
  count: number
  tone: TaskSemanticTone
  icon: string
}

const badgeStatus = computed(() => runBadgeStatus(props.job.status))
const typeIdentity = computed(() => runTypeIdentity(props.job.type))
const resultItems = computed(() => runResultItems(props.job))
const timelineItems = computed(() => buildRunTimeline(props.job))
const mediaPolicyItems = computed(() => {
  const labels: Record<string, string> = {
    manual_exempt: '人工豁免',
    reuse_managed: '复用托管',
    reuse_external: '复用外部',
    register_managed: '恢复托管登记',
    register_external: '登记外部',
    download_missing: '缺失下载',
    redownload_replaced: '替换下载',
  }
  const counts = new Map<string, number>()
  for (const song of props.job.songs) {
    const trace = song.metadata?.matchTrace
    const evidence = trace && typeof trace.evidence === 'object' && trace.evidence
      ? trace.evidence as Record<string, unknown>
      : null
    const disposition = typeof evidence?.mediaPolicy === 'string'
      ? evidence.mediaPolicy
      : null
    if (disposition) counts.set(disposition, (counts.get(disposition) ?? 0) + 1)
  }
  return [...counts.entries()].flatMap(([key, count]) =>
    labels[key] ? [{ key, count, label: labels[key] }] : [],
  )
})

const songFilters = computed(() => SONG_STATUS_BUCKETS.map(bucket => ({
  ...bucket,
  count: songStatusBucketCount(props.job.songs, bucket.key),
})))

function applyFilter(songs: SongTask[]): SongTask[] {
  return songs.filter(song => songMatchesStatusBucket(song.status, songFilter.value))
}

const allFilteredSongs = computed(() => applyFilter(props.job.songs))
const filteredSongCount = computed(() => allFilteredSongs.value.length)
const filteredSongs = computed(() => allFilteredSongs.value.slice(0, renderLimit.value))

const songGroups = computed<SongGroup[]>(() => {
  const hasSourceIds = props.job.songs.some((s) => s.sourceId)
  if (!hasSourceIds) return []

  const groups = new Map<string, SongTask[]>()
  for (const s of filteredSongs.value) {
    const key = s.sourceId || '__unknown__'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }

  return Array.from(groups.entries()).map(([sourceId, songs]) => {
    const filtered = applyFilter(songs)
    const name = sourceNameMap.value[sourceId] || sourceId.slice(0, 8)
    return { sourceId, sourceName: name, stats: buildSongGroupStats(filtered), songs: filtered }
  }).filter((g) => g.songs.length > 0)
})

function buildSongGroupStats(songs: SongTask[]): SongGroupStat[] {
  const total: SongGroupStat = {
    key: 'all',
    label: '首',
    count: songs.length,
    tone: 'neutral',
    icon: 'music',
  }
  const breakdown = SONG_STATUS_BUCKETS
    .filter(bucket => bucket.key !== 'all')
    .map(bucket => ({ ...bucket, count: songStatusBucketCount(songs, bucket.key) }))
    .filter(stat => stat.count > 0)
  return [total, ...breakdown]
}

async function fetchSourceNames() {
  try {
    const sources = await api.get<Array<{
      id: string
      name: string
      type: string
      trackCount: number
      enabled: boolean
      subscribed: boolean
    }>>('/playlist-sources')
    for (const s of sources) {
      sourceNameMap.value[s.id] = s.name
      sourceTypeMap.value[s.id] = s.type
      sourceSubscribedMap.value[s.id] = s.subscribed ?? false
    }
    playlistTotalSongs.value = sources
      .filter(s => s.enabled)
      .reduce((sum, s) => sum + (s.trackCount || 0), 0)

    // Auto-collapse groups with >100 songs
    for (const g of songGroups.value) {
      if (g.songs.length > 100) collapsedGroups.add(g.sourceId)
    }
  } catch { /* ignore */ }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

async function handleRetry(song: SongTask) {
  if (retryingSongs.value.has(song.id)) return
  retryingSongs.value.add(song.id)
  retryingSongs.value = new Set(retryingSongs.value) // trigger reactivity
  try {
    if (props.job.type === 'manual_download') {
      await api.post(`/downloads/tasks/${song.id}/retry`)
    } else {
      await api.post(`/runs/${props.job.id}/retry-song`, { songId: song.id })
    }
  } catch {
    retryingSongs.value.delete(song.id)
    retryingSongs.value = new Set(retryingSongs.value)
  }
}

async function handleRetryAll(sourceId: string) {
  if (retryingSources.value.has(sourceId)) return
  retryingSources.value.add(sourceId)
  retryingSources.value = new Set(retryingSources.value)
  try {
    await api.post(`/playlist-sources/${sourceId}/retry-failed`)
  } catch {
    retryingSources.value.delete(sourceId)
    retryingSources.value = new Set(retryingSources.value)
  }
}

const unsubs: Array<() => void> = []

onMounted(() => {
  fetchSourceNames()
  unsubs.push(sseSubscribe('song-retry-progress', (data) => {
    const { songId, status, filePath, fileType, ops, error: errData, progress } = data as Record<string, unknown>
    if (!songId) return

    // Track download progress
    if (typeof progress === 'number') {
      retryProgress.value = { ...retryProgress.value, [songId as string]: progress }
    }

    const song = props.job.songs.find((s) => s.id === songId)
    if (!song) return

    if (status === 'success') {
      song.status = 'success'
      song.phase = 'done'
      if (filePath) song.filePath = filePath as string
      if (fileType) song.fileType = fileType as string
      if (ops) song.ops = ops as SongTask['ops']
      delete song.error
      delete retryProgress.value[songId as string]
    } else if (status === 'downloading') {
      song.status = 'downloading'
      song.phase = 'download'
    } else if (status === 'failed') {
      song.status = 'failed_download'
      song.phase = 'download'
      if (errData) song.error = {
        title: '重试失败',
        message: (errData as Record<string, unknown>).message as string || '下载失败',
        stage: 'download',
        songName: song.songName,
        artist: song.artist,
      }
      delete retryProgress.value[songId as string]
    }

    retryingSongs.value.delete(songId as string)
    retryingSongs.value = new Set(retryingSongs.value)
  }))
  // Clear batch-retry state when any sync finishes
  unsubs.push(sseSubscribe('stage-change', (data) => {
    const { stage } = data as Record<string, unknown>
    if (stage === 'idle') {
      retryingSources.value = new Set()
    }
  }))
})

onUnmounted(() => {
  for (const u of unsubs) u()
})
</script>

<style scoped>
.run-detail{display:flex;flex-direction:column;gap:1.25rem}
.run-detail__nav{display:flex;min-height:2.75rem;align-items:center;justify-content:space-between;gap:1rem}
.run-detail__back{display:inline-flex;min-height:2.75rem;align-items:center;gap:.45rem;padding:0;border:0;background:transparent;color:var(--text-secondary);font-size:.82rem;font-weight:650;cursor:pointer;transition:color 150ms ease}
.run-detail__back:hover{color:var(--text-primary)}
.run-detail__id{overflow:hidden;color:var(--text-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.7rem;text-overflow:ellipsis;white-space:nowrap}
.run-detail__expired{display:flex;align-items:center;gap:.85rem;padding:1rem;color:var(--text-secondary)}
.run-detail__expired>div{min-width:0;flex:1}.run-detail__expired strong{display:block;color:var(--text-primary);font-size:.84rem}.run-detail__expired p{margin:.25rem 0 0;font-size:.76rem}
.run-detail__hero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:1rem;padding:1.25rem;overflow:hidden}
.run-detail__hero::after{content:"";position:absolute;top:-5rem;right:-4rem;width:14rem;height:14rem;border-radius:999px;background:currentColor;filter:blur(1px);opacity:.035;pointer-events:none}
.run-detail__hero--sync{color:var(--run-sync);background:linear-gradient(135deg,var(--run-sync-soft),transparent 46%),var(--bg-surface)}
.run-detail__hero--download{color:var(--run-download);background:linear-gradient(135deg,var(--run-download-soft),transparent 46%),var(--bg-surface)}
.run-detail__hero--repair{color:var(--run-repair);background:linear-gradient(135deg,var(--run-repair-soft),transparent 46%),var(--bg-surface)}
.run-detail__hero-icon{display:flex;width:3.25rem;height:3.25rem;align-items:center;justify-content:center;border:1px solid currentColor;border-radius:1rem;background:color-mix(in srgb,currentColor 10%,var(--bg-surface));box-shadow:var(--shadow-xs)}
.run-detail__hero-copy{min-width:0;color:var(--text-primary)}
.run-detail__hero-labels{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.run-detail__preview{display:inline-flex;min-height:1.75rem;align-items:center;padding:0 .55rem;border:1px solid var(--ignored-border);border-radius:999px;background:var(--ignored-soft);color:var(--ignored);font-size:.7rem;font-weight:700}
.run-detail__hero h2{margin:.75rem 0 0;color:var(--text-primary);font-size:1.05rem;font-weight:750;line-height:1.45}
.run-detail__hero>div>p{margin:.3rem 0 0;color:var(--text-secondary);font-size:.8rem;line-height:1.55}
.run-detail__hero-meta{display:flex;align-items:center;gap:.65rem 1rem;flex-wrap:wrap;margin-top:.8rem;color:var(--text-tertiary);font-size:.72rem}
.run-detail__hero-meta span{display:inline-flex;align-items:center;gap:.35rem}
.run-detail__stats{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.7rem}
.run-stat{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;align-items:center;column-gap:.55rem;min-width:0;padding:.8rem;border:1px solid;border-radius:var(--radius-lg)}
.run-stat>.app-icon{grid-row:1 / span 2}
.run-stat p{margin:0;font-size:1rem;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.15}
.run-stat span{overflow:hidden;color:currentColor;font-size:.68rem;font-weight:650;line-height:1.25;text-overflow:ellipsis;white-space:nowrap;opacity:.82}
.run-detail__section-toggle{display:flex;width:100%;min-height:4rem;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1.1rem;border:0;border-bottom:1px solid var(--border-primary);background:transparent;color:var(--text-primary);text-align:left;cursor:pointer;transition:background 150ms ease}
.run-detail__section-toggle:hover{background:var(--bg-hover)}
.run-detail__section-toggle>span{display:flex;flex-direction:column;gap:.18rem}
.run-detail__section-toggle strong{font-size:.875rem;font-weight:750}
.run-detail__section-toggle small{color:var(--text-tertiary);font-size:.7rem;font-weight:500}
.run-detail__timeline{padding:1.1rem}
.run-detail__song-toolbar{display:flex;min-height:4rem;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 1.25rem;border-bottom:1px solid var(--border-primary)}
.run-detail__song-title{display:flex;align-items:center;gap:.65rem;min-width:0}
.run-detail__song-title h3{margin:0;color:var(--text-primary);font-size:.875rem;font-weight:750;white-space:nowrap}
.run-detail__collapse-all{display:inline-flex;width:2.25rem;height:2.25rem;align-items:center;justify-content:center;border:1px solid var(--border-primary);border-radius:.72rem;background:var(--bg-input);color:var(--text-secondary);cursor:pointer;transition:background 150ms ease,color 150ms ease,border-color 150ms ease,transform 150ms ease}
.run-detail__collapse-all:hover:not(:disabled){border-color:var(--accent-border);background:var(--accent-muted);color:var(--accent-strong);transform:translateY(-1px)}
.run-detail__collapse-all:disabled{opacity:.45;cursor:not-allowed}
.run-detail__collapse-all:focus-visible,.run-detail__song-filter:focus-visible,.run-detail__song-group-toggle:focus-visible,.run-detail__retry-source:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.run-detail__song-filters{display:flex;align-items:center;justify-content:flex-end;gap:.45rem;flex-wrap:wrap}
.run-detail__song-filter{display:inline-flex;min-height:2.25rem;align-items:center;gap:.35rem;padding:.25rem .6rem;border:1px solid;border-radius:999px;font-size:.68rem;font-weight:700;line-height:1;cursor:pointer;transition:transform 150ms ease,box-shadow 150ms ease,filter 150ms ease}
.run-detail__song-filter:hover{filter:saturate(1.08);transform:translateY(-1px)}
.run-detail__song-filter.is-active{box-shadow:0 0 0 2px color-mix(in srgb,currentColor 18%,transparent),var(--shadow-xs)}
.run-detail__song-filter strong{font-size:.65rem;font-weight:800;font-variant-numeric:tabular-nums;opacity:.88}
.run-detail__song-group{display:flex;min-height:3.25rem;align-items:center;gap:.75rem;padding:.35rem 1.25rem;border-bottom:1px solid var(--border-primary);background:var(--bg-app)}
.run-detail__song-group-toggle{display:flex;min-width:0;min-height:2.75rem;flex:1;align-items:center;gap:.65rem;padding:0;border:0;background:transparent;color:var(--text-primary);text-align:left;cursor:pointer}
.run-detail__song-group-name{min-width:0;flex:1;color:var(--text-primary);font-size:.75rem;font-weight:650;line-height:1.4;overflow-wrap:anywhere}
.run-detail__song-group-toggle:hover .run-detail__song-group-stats{filter:saturate(1.08)}
.run-detail__song-group-stats{display:flex;align-items:center;justify-content:flex-end;gap:.35rem;flex-wrap:wrap;transition:filter 150ms ease}
.run-detail__song-group-stat{display:inline-flex;min-height:1.35rem;align-items:center;gap:.25rem;padding:.08rem .45rem;border:1px solid;border-radius:999px;font-size:.64rem;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
.run-detail__retry-source{display:inline-flex;min-height:2.25rem;align-items:center;justify-content:center;padding:.2rem .65rem;border:0;border-radius:.65rem;background:transparent;font-size:.68rem;font-weight:700;transition:background 150ms ease,color 150ms ease;cursor:pointer;flex:none}
@media(max-width:1180px){.run-detail__stats{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:720px){
  .run-detail__hero{grid-template-columns:1fr}
  .run-detail__hero-icon{width:2.75rem;height:2.75rem}
  .run-detail__stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .run-detail__id{max-width:9rem}
  .run-detail__section-toggle small{display:none}
  .run-detail__timeline{padding:.9rem}
  .run-detail__song-toolbar{align-items:flex-start;flex-direction:column}
  .run-detail__song-filters{justify-content:flex-start}
  .run-detail__song-group{align-items:flex-start;flex-direction:column;gap:.35rem;padding:.55rem 1rem}
  .run-detail__song-group-toggle{width:100%;align-items:flex-start;flex-wrap:wrap;gap:.55rem}
  .run-detail__song-group-name{flex:1 1 calc(100% - 7rem);font-size:.84rem;line-height:1.45}
  .run-detail__song-group-stats{flex:1 1 100%;justify-content:flex-start;padding-left:3.05rem}
}
</style>
