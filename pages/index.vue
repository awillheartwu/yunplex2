<template>
  <div class="max-w-[1800px] space-y-5">
    <!-- ═══ Status bar ═══ -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium" style="background:var(--bg-surface);border-color:var(--border-primary);color:var(--text-secondary)">
        <span class="w-2 h-2 rounded-full" :class="plexOnline ? 'bg-success' : 'bg-danger'" />
        Plex {{ plexOnline ? '在线' : '离线' }}
      </div>
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium" style="background:var(--bg-surface);border-color:var(--border-primary);color:var(--text-secondary)">
        <span class="w-2 h-2 rounded-full" :class="neteaseOk ? 'bg-success' : 'bg-danger'" />
        网易云 {{ neteaseOk ? '已登录' : '未配置' }}
      </div>
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium" style="background:var(--bg-surface);border-color:var(--border-primary);color:var(--text-secondary)">
        <span class="w-2 h-2 rounded-full" :class="syncState?.isRunning ? 'bg-warning animate-pulse' : 'bg-muted-deep'" />
        {{ syncState?.isRunning ? '同步中' : '空闲' }}
      </div>
      <span v-if="syncState?.lastSyncAt" class="text-xs text-muted-deep ml-1">
        上次 {{ formatRelative(syncState.lastSyncAt) }}
      </span>
      <div class="flex items-center gap-1.5 ml-auto">
        <label class="flex items-center gap-1 text-xs cursor-pointer select-none" style="color:var(--text-secondary)">
          <input v-model="dryRun" type="checkbox" class="w-3 h-3 rounded accent-[#5e6ad2] cursor-pointer" />
          预览
        </label>
        <button class="btn btn-primary" :disabled="syncState?.isRunning || syncLoading" @click="handleSync">
          {{ syncState?.isRunning ? '同步中' : '手动同步' }}
        </button>
        <button v-if="syncState?.isRunning" class="btn btn-danger btn-sm" @click="handleCancel">停止</button>
      </div>
    </div>

    <!-- ═══ Core stats + Sync stage ═══ -->
    <div class="grid grid-cols-3 gap-4">
      <!-- Stats cards -->
      <div class="grid grid-cols-2 gap-2.5">
        <div class="section-card p-3">
          <p class="text-2xs font-medium" style="color:var(--text-tertiary)">已同步曲目</p>
          <p class="text-lg font-semibold tracking-tight mt-0.5" style="color:var(--text-primary)">{{ syncState?.successCount ?? 0 }}</p>
        </div>
        <div class="section-card p-3">
          <p class="text-2xs font-medium" style="color:var(--text-tertiary)">失败次数</p>
          <p class="text-lg font-semibold tracking-tight mt-0.5" :class="(syncState?.failureCount ?? 0) > 0 ? 'text-danger' : ''" style="color:var(--text-primary)">{{ syncState?.failureCount ?? 0 }}</p>
        </div>
        <div class="section-card p-3">
          <p class="text-2xs font-medium" style="color:var(--text-tertiary)">歌单监控</p>
          <p class="text-lg font-semibold tracking-tight mt-0.5" style="color:var(--text-primary)">{{ config?.netease.playlistIds.length ?? 0 }}</p>
        </div>
        <div class="section-card p-3">
          <p class="text-2xs font-medium" style="color:var(--text-tertiary)">最后一次</p>
          <p class="text-lg font-semibold tracking-tight mt-0.5" :class="syncState?.lastSyncResult === 'failure' ? 'text-danger' : ''" style="color:var(--text-primary)">{{ syncState?.lastSyncResult === 'success' ? '成功' : syncState?.lastSyncResult === 'failure' ? '异常' : '—' }}</p>
        </div>
      </div>

      <!-- Sync stage panel -->
      <div class="section-card p-3.5">
        <p class="text-2xs font-medium mb-2" style="color:var(--text-tertiary)">同步阶段</p>
        <div class="space-y-1">
          <div v-for="stage in stages" :key="stage.key" class="flex items-center gap-2 text-xs">
            <span
class="w-1.5 h-1.5 rounded-full shrink-0"
              :class="syncState?.currentStage === stage.key ? 'bg-accent animate-pulse' : isStageDone(stage.key) ? 'bg-muted-deep' : 'bg-[var(--border-secondary)]'" />
            <span
:class="syncState?.currentStage === stage.key ? 'font-medium' : ''"
              :style="syncState?.currentStage === stage.key ? 'color:var(--text-primary)' : isStageDone(stage.key) ? 'color:var(--text-tertiary)' : 'color:var(--text-tertiary)'">{{ stage.label }}</span>
            <span v-if="syncState?.currentStage === stage.key && syncState?.progress" class="text-2xs font-mono ml-auto" style="color:var(--text-secondary)">
              {{ syncState.progress.current }}/{{ syncState.progress.total }}
            </span>
          </div>
        </div>
        <!-- Progress bar when running -->
        <div v-if="syncState?.isRunning && syncState?.progress" class="mt-2.5 h-1 rounded-full overflow-hidden" style="background:var(--bg-input)">
          <div
class="h-full rounded-full transition-all duration-500" style="background:#5e6ad2"
            :style="{ width: (syncState.progress.current / syncState.progress.total * 100) + '%' }" />
        </div>
        <p v-if="syncState?.isRunning && syncState?.currentSong" class="text-2xs mt-1.5 truncate font-mono" style="color:var(--text-tertiary)">
          {{ syncState.currentSong }}
        </p>
      </div>

      <!-- Errors panel -->
      <div class="section-card p-3.5">
        <div class="flex items-center justify-between mb-2">
          <p class="text-2xs font-medium" style="color:var(--text-tertiary)">最近问题</p>
          <span v-if="recentErrors.length" class="text-2xs font-medium text-danger">{{ recentErrors.length }}</span>
        </div>
        <div v-if="recentErrors.length" class="space-y-1.5">
          <div v-for="(err, i) in recentErrors.slice(0, 6)" :key="i" class="flex items-start gap-2 text-xs">
            <span class="text-danger shrink-0 mt-0.5">!</span>
            <span class="truncate" style="color:var(--text-secondary)">{{ err.songName || err.message }}</span>
            <span class="text-2xs shrink-0 ml-auto" style="color:var(--text-tertiary)">{{ formatTimeCompact(err.timestamp) }}</span>
          </div>
        </div>
        <div v-else class="text-xs text-center py-4" style="color:var(--text-tertiary)">暂无问题</div>
      </div>
    </div>

    <!-- ═══ Recently added + Timeline ═══ -->
    <div class="grid grid-cols-2 gap-4">
      <!-- Recently added tracks -->
      <div class="section-card overflow-hidden">
        <div class="px-4 py-2.5 flex items-center justify-between" style="border-bottom:1px solid var(--border-primary)">
          <p class="text-xs font-semibold" style="color:var(--text-primary)">最近添加</p>
          <span class="text-2xs" style="color:var(--text-tertiary)">{{ recentTracks.length }} 首</span>
        </div>
        <div v-if="recentTracks.length" class="divide-y" style="border-color:var(--border-primary)">
          <div v-for="track in recentTracks.slice(0, 8)" :key="track.id" class="px-4 py-2 flex items-center gap-3 hover:bg-[var(--bg-hover)] transition-colors duration-150">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium truncate" style="color:var(--text-primary)">{{ track.title }}</p>
              <p class="text-2xs truncate" style="color:var(--text-secondary)">{{ track.artist }}</p>
            </div>
            <span
class="text-2xs px-1.5 py-0.5 rounded font-medium shrink-0"
              :class="track.status === 'success' ? 'bg-[#2ecc7118] text-success' : track.status === 'failed_plex_match' ? 'bg-[#f1c40f18] text-warning' : 'bg-[#e74c3c18] text-danger'">
              {{ track.status === 'success' ? '已同步' : track.status === 'failed_plex_match' ? '未匹配' : '失败' }}
            </span>
          </div>
        </div>
        <div v-else class="flex items-center justify-center py-10">
          <p class="text-xs" style="color:var(--text-tertiary)">执行首次同步后展示</p>
        </div>
      </div>

      <!-- Recent timeline -->
      <div class="section-card overflow-hidden">
        <div class="px-4 py-2.5 flex items-center justify-between" style="border-bottom:1px solid var(--border-primary)">
          <p class="text-xs font-semibold" style="color:var(--text-primary)">同步时间线</p>
          <NuxtLink to="/jobs" class="text-2xs hover:underline" style="color:var(--text-secondary)">任务中心</NuxtLink>
        </div>
        <div v-if="recentJobs.length" class="divide-y" style="border-color:var(--border-primary)">
          <div v-for="job in recentJobs.slice(0, 6)" :key="job.id" class="px-4 py-2.5 flex items-center gap-3">
            <div class="w-2.5 h-2.5 rounded-full shrink-0" :class="job.status === 'success' ? 'bg-success' : job.status === 'partial' ? 'bg-warning' : 'bg-danger'" />
            <div class="flex-1 min-w-0">
              <p class="text-xs truncate" style="color:var(--text-primary)">{{ job.summary || '同步任务' }}</p>
              <p class="text-2xs" style="color:var(--text-secondary)">{{ job.successSongs }} 成功{{ job.failedSongs > 0 ? ' · ' + job.failedSongs + ' 失败' : '' }}{{ job.skippedSongs > 0 ? ' · ' + job.skippedSongs + ' 跳过' : '' }}</p>
            </div>
            <span class="text-2xs shrink-0 font-mono" style="color:var(--text-tertiary)">{{ formatDuration(job.durationMs) }}</span>
            <span class="text-2xs shrink-0" style="color:var(--text-tertiary)">{{ formatRelative(job.startedAt) }}</span>
          </div>
        </div>
        <div v-else class="flex items-center justify-center py-10">
          <p class="text-xs" style="color:var(--text-tertiary)">执行首次同步后展示</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AppConfig } from '~~/server/lib/config/types'
import type { LogEntry } from '~~/server/lib/log/types'

const api = useApi()
const { state: syncState, loading: syncLoading, triggerSync, cancelSync, startPolling, stopPolling } = useSync()
const config = ref<AppConfig | null>(null)
const recentJobs = ref<JobSummary[]>([])
const recentTracks = ref<TrackCard[]>([])
const recentErrors = ref<(LogEntry & { songName?: string })[]>([])
const dryRun = ref(false)
const plexOnline = ref(false)
const neteaseOk = ref(false)

interface JobSummary { id: string; startedAt: string; status: string; durationMs: number; summary: string; successSongs: number; failedSongs: number; skippedSongs: number }
interface TrackCard { id: string; title: string; artist: string; status: string }

const stages = [
  { key: 'idle', label: '空闲' },
  { key: 'fetching_playlist', label: '获取歌单' },
  { key: 'comparing', label: '对比 Plex 歌单' },
  { key: 'downloading', label: '下载歌曲' },
  { key: 'processing_tags', label: '写入元数据' },
  { key: 'refreshing_plex', label: '刷新 Plex 库' },
  { key: 'updating_plex_playlist', label: '更新 Plex 歌单' },
]

const stageOrder = ['idle', 'fetching_playlist', 'comparing', 'downloading', 'processing_tags', 'refreshing_plex', 'updating_plex_playlist']
function isStageDone(key: string): boolean {
  const current = syncState.value?.currentStage
  if (!current || current === 'idle') return false
  if (current === 'error' || current === 'cancelled') return stageOrder.indexOf(key) <= stageOrder.indexOf('updating_plex_playlist')
  const ci = stageOrder.indexOf(current)
  const ki = stageOrder.indexOf(key)
  return ki < ci
}

let pollTimer: ReturnType<typeof setInterval> | null = null

async function fetchData() {
  const [cfg, jobsRes, logs] = await Promise.all([
    api.get<AppConfig>('/config'),
    api.get<{ items: JobSummary[] }>('/jobs', { limit: '10' }),
    api.get<LogEntry[]>('/logs', { limit: '30' }),
  ])
  config.value = cfg
  recentJobs.value = jobsRes.items || []
  plexOnline.value = !!cfg.plex.server
  neteaseOk.value = !!cfg.netease.cookie

  // Extract errors from logs
  recentErrors.value = (logs || []).filter(l => l.level === 'error').slice(0, 10).map(l => {
    let songName: string | undefined
    const match = l.message?.match(/下载失败:\s*(.+)/)
    if (match) songName = match[1]
    return { ...l, songName }
  })

  // Extract recent tracks from last successful/partial job
  const lastJob = jobsRes.items?.find(j => j.status === 'success' || j.status === 'partial' || j.status === 'failed')
  if (lastJob) {
    try {
      const detail = await api.get<{ songs: { id: string; songName: string; artist: string; status: string; metadata?: { releaseDate?: string } }[] }>(`/jobs/${lastJob.id}`)
      recentTracks.value = (detail.songs || []).filter(s => s.status === 'success' || s.status === 'failed_plex_match' || s.status === 'failed_plex_insert').slice(0, 10).map(s => ({
        id: s.id, title: s.songName, artist: s.artist, status: s.status,
      }))
    } catch { /* non-critical */ }
  }
}

async function handleSync() {
  try { await triggerSync(dryRun.value); startPolling(2000); await fetchData() } catch { /* handled */ }
}

async function handleCancel() {
  try { await cancelSync(); await fetchData() } catch { /* handled */ }
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

function formatTimeCompact(ts: string): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60}s`
}

onMounted(async () => { startPolling(15000); await fetchData() })
onUnmounted(() => { stopPolling(); if (pollTimer) clearInterval(pollTimer) })
</script>
