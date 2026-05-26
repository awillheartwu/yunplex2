<template>
  <div class="space-y-4">
    <!-- ═══ Status bar ═══ -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium" style="background:var(--bg-surface);border-color:var(--border-primary);color:var(--text-secondary)">
        <span class="w-2 h-2 rounded-full" :class="plexOnline ? 'bg-success' : 'bg-danger'" /> Plex {{ plexOnline ? '在线' : '离线' }}
      </div>
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium" style="background:var(--bg-surface);border-color:var(--border-primary);color:var(--text-secondary)">
        <span class="w-2 h-2 rounded-full" :class="neteaseOk ? 'bg-success' : 'bg-danger'" /> 网易云 {{ neteaseOk ? '已登录' : '未配置' }}
      </div>
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium" style="background:var(--bg-surface);border-color:var(--border-primary);color:var(--text-secondary)">
        <span class="w-2 h-2 rounded-full" :class="syncState?.isRunning ? 'bg-warning animate-pulse' : 'bg-muted-deep'" /> {{ syncState?.isRunning ? '同步中' : '空闲' }}
      </div>
      <span v-if="syncState?.lastSyncAt" class="text-xs text-muted-deep">上次 {{ formatRelative(syncState.lastSyncAt) }}</span>
      <div class="flex items-center gap-1.5 ml-auto">
        <label class="flex items-center gap-1 text-xs cursor-pointer select-none" style="color:var(--text-secondary)">
          <input v-model="dryRun" type="checkbox" class="w-3 h-3 rounded accent-[#5e6ad2] cursor-pointer" /> 预览
        </label>
        <button class="btn btn-primary" :disabled="syncState?.isRunning || syncLoading" @click="handleSync">{{ syncState?.isRunning ? '同步中' : '手动同步' }}</button>
        <button v-if="syncState?.isRunning" class="btn btn-danger btn-sm" @click="handleCancel">停止</button>
      </div>
    </div>

    <!-- ═══ Row 1: Sync Overview + Issues ═══ -->
    <div class="grid grid-cols-3 gap-4">
      <!-- Sync Overview (2 columns wide) -->
      <div class="col-span-2 section-card p-4">
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm font-semibold" style="color:var(--text-primary)">同步概览</p>
        </div>
        <!-- 4 metrics in one row -->
        <div class="grid grid-cols-4 gap-3 mb-3">
          <div>
            <p class="text-2xs font-medium" style="color:var(--text-tertiary)">已同步曲目</p>
            <p class="text-xl font-semibold tracking-tight mt-0.5" style="color:var(--text-primary)">{{ syncState?.successCount ?? 0 }}</p>
          </div>
          <div>
            <p class="text-2xs font-medium" style="color:var(--text-tertiary)">失败次数</p>
            <p class="text-xl font-semibold tracking-tight mt-0.5" :class="(syncState?.failureCount ?? 0) > 0 ? 'text-danger' : ''" style="color:var(--text-primary)">{{ syncState?.failureCount ?? 0 }}</p>
          </div>
          <div>
            <p class="text-2xs font-medium" style="color:var(--text-tertiary)">歌单监控</p>
            <p class="text-xl font-semibold tracking-tight mt-0.5" style="color:var(--text-primary)">{{ config?.netease.playlistIds.length ?? 0 }}</p>
          </div>
          <div>
            <p class="text-2xs font-medium" style="color:var(--text-tertiary)">最后结果</p>
            <p class="text-xl font-semibold tracking-tight mt-0.5" :class="syncState?.lastSyncResult === 'failure' ? 'text-danger' : ''" style="color:var(--text-primary)">{{ syncState?.lastSyncResult === 'success' ? '成功' : syncState?.lastSyncResult === 'failure' ? '异常' : '—' }}</p>
          </div>
        </div>
      </div>

      <!-- Issues -->
      <div class="section-card p-4">
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs font-semibold" style="color:var(--text-primary)">最近问题</p>
          <span v-if="recentErrors.length" class="text-2xs font-medium text-danger">{{ recentErrors.length }}</span>
        </div>
        <div v-if="recentErrors.length" class="space-y-1.5">
          <div v-for="(err, i) in recentErrors.slice(0, 5)" :key="i" class="flex items-start gap-1.5 text-xs">
            <span class="text-danger shrink-0 mt-0.5 font-bold">!</span>
            <span class="truncate flex-1" style="color:var(--text-secondary)">{{ err.songName || err.message }}</span>
            <span class="text-2xs shrink-0" style="color:var(--text-tertiary)">{{ formatTimeCompact(err.timestamp) }}</span>
          </div>
        </div>
        <div v-else class="flex items-center justify-center py-6">
          <p class="text-xs" style="color:var(--text-tertiary)">暂无问题</p>
        </div>
      </div>
    </div>

    <!-- ═══ Sync stage bar ═══ -->
    <NuxtLink to="/task" class="section-card p-4 flex items-center gap-2 hover:border-[var(--border-secondary)] transition-colors duration-150 cursor-pointer block">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <template v-for="(stage, idx) in activeStages" :key="stage.key">
          <span class="w-2 h-2 rounded-full shrink-0" :class="stageDotClass(stage.key)" />
          <span
class="text-2xs shrink-0"
            :style="{ color: stageTextColor(stage.key) }"
            :class="syncState?.currentStage === stage.key ? 'font-medium' : ''">{{ stage.label }}</span>
          <svg v-if="idx < activeStages.length - 1" width="10" height="10" viewBox="0 0 10 10" fill="none" class="shrink-0">
            <path d="M3.5 2l3 3-3 3" :stroke="isStageDone(activeStages[idx+1].key) ? '#5e6ad2' : 'var(--border-secondary)'" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </template>
      </div>
      <div v-if="syncState?.isRunning && syncState?.progress" class="w-24 h-1 rounded-full overflow-hidden shrink-0" style="background:var(--bg-input)">
        <div class="h-full rounded-full transition-all duration-500" style="background:#5e6ad2" :style="{ width: (syncState.progress.current / syncState.progress.total * 100) + '%' }" />
      </div>
      <span class="text-2xs shrink-0" style="color:var(--text-tertiary)">下载状态 →</span>
    </NuxtLink>

    <!-- ═══ Row 2: Recently Added + Timeline ═══ -->
    <div class="grid grid-cols-3 gap-4">
      <!-- Recently Added (2 columns) -->
      <div class="col-span-2 section-card overflow-hidden">
        <div class="px-4 py-2.5 flex items-center justify-between" style="border-bottom:1px solid var(--border-primary)">
          <p class="text-xs font-semibold" style="color:var(--text-primary)">最近添加</p>
          <span class="text-2xs" style="color:var(--text-tertiary)">{{ recentTracks.length }} 首</span>
        </div>
        <div v-if="recentTracks.length" class="divide-y" style="border-color:var(--border-primary)">
          <div v-for="track in recentTracks.slice(0, 6)" :key="track.id" class="px-4 py-2.5 flex items-center gap-3 hover:bg-[var(--bg-hover)] transition-colors duration-150">
            <div class="w-9 h-9 rounded overflow-hidden shrink-0 flex items-center justify-center" style="background:var(--bg-input)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="#5e6ad2" stroke-width="1.3"/><path d="M10.5 5.5v3.8a1.8 1.8 0 01-1.8 1.8 1.8 1.8 0 01-1.8-1.8 1.8 1.8 0 013.6 0z" stroke="#5e6ad2" stroke-width="1.3" stroke-linecap="round"/></svg>
            </div>
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
        <div v-else class="flex items-center justify-center py-12">
          <div class="text-center">
            <div class="w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center" style="background:var(--bg-input)">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--text-tertiary)" stroke-width="1.3"/><path d="M10.5 5.5v3.8a1.8 1.8 0 01-1.8 1.8 1.8 1.8 0 01-1.8-1.8 1.8 1.8 0 013.6 0z" stroke="var(--text-tertiary)" stroke-width="1.3" stroke-linecap="round"/></svg>
            </div>
            <p class="text-xs" style="color:var(--text-tertiary)">执行首次同步后显示新增歌曲</p>
          </div>
        </div>
      </div>

      <!-- Timeline (1 column) -->
      <div class="section-card overflow-hidden">
        <div class="px-4 py-2.5 flex items-center justify-between" style="border-bottom:1px solid var(--border-primary)">
          <p class="text-xs font-semibold" style="color:var(--text-primary)">同步时间线</p>
          <NuxtLink to="/jobs" class="text-2xs hover:underline" style="color:var(--text-secondary)">历史</NuxtLink>
        </div>
        <div v-if="recentJobs.length" class="divide-y" style="border-color:var(--border-primary)">
          <NuxtLink v-for="job in recentJobs.slice(0, 5)" :key="job.id" :to="`/jobs?id=${job.id}`" class="block px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors duration-150">
            <div class="flex items-center gap-2 mb-0.5">
              <div class="w-2 h-2 rounded-full shrink-0" :class="job.status === 'success' ? 'bg-success' : job.status === 'partial' ? 'bg-warning' : 'bg-danger'" />
              <span class="text-2xs font-mono" style="color:var(--text-tertiary)">{{ formatRelative(job.startedAt) }}</span>
              <span class="text-2xs font-mono ml-auto" style="color:var(--text-tertiary)">{{ formatDuration(job.durationMs) }}</span>
            </div>
            <p class="text-xs ml-4" style="color:var(--text-secondary)">{{ job.successSongs }} 成功{{ job.failedSongs > 0 ? ' · ' + job.failedSongs + ' 失败' : '' }}{{ job.skippedSongs > 0 ? ' · ' + job.skippedSongs + ' 跳过' : '' }}</p>
          </NuxtLink>
        </div>
        <div v-else class="flex items-center justify-center py-12">
          <p class="text-xs" style="color:var(--text-tertiary)">执行首次同步后展示</p>
        </div>
      </div>
    </div>

    <!-- ═══ Row 3: System panels ═══ -->
    <div class="grid grid-cols-3 gap-4">
      <div class="section-card p-3.5">
        <p class="text-2xs font-medium mb-2" style="color:var(--text-tertiary)">Plex 状态</p>
        <div class="space-y-1 text-xs">
          <div class="flex justify-between"><span style="color:var(--text-secondary)">服务器</span><span style="color:var(--text-primary)">{{ config?.plex.server || '—' }}</span></div>
          <div class="flex justify-between"><span style="color:var(--text-secondary)">资料库</span><span style="color:var(--text-primary)">{{ config?.plex.section || '—' }}</span></div>
          <div class="flex justify-between"><span style="color:var(--text-secondary)">连接</span><span :class="plexOnline ? 'text-success' : 'text-danger'">{{ plexOnline ? '正常' : '离线' }}</span></div>
        </div>
      </div>
      <div class="section-card p-3.5">
        <p class="text-2xs font-medium mb-2" style="color:var(--text-tertiary)">下载状态</p>
        <div class="space-y-1 text-xs">
          <div class="flex justify-between"><span style="color:var(--text-secondary)">目录</span><span class="truncate ml-2" style="color:var(--text-primary);max-width:140px">{{ config?.download.dir || '—' }}</span></div>
          <div class="flex justify-between"><span style="color:var(--text-secondary)">音质</span><span style="color:var(--text-primary)">{{ qualityLabel }}</span></div>
          <div class="flex justify-between"><span style="color:var(--text-secondary)">同步次数</span><span style="color:var(--text-primary)">{{ totalSyncs }}</span></div>
        </div>
      </div>
      <div class="section-card p-3.5">
        <p class="text-2xs font-medium mb-2" style="color:var(--text-tertiary)">系统状态</p>
        <div class="space-y-1 text-xs">
          <div class="flex justify-between"><span style="color:var(--text-secondary)">自动同步</span><span :class="config?.sync.enabled ? 'text-success' : ''" style="color:var(--text-primary)">{{ config?.sync.enabled ? '已启用' : '已禁用' }}</span></div>
          <div class="flex justify-between"><span style="color:var(--text-secondary)">同步间隔</span><span style="color:var(--text-primary)">{{ config?.sync.intervalMinutes ?? 30 }} 分钟</span></div>
          <div class="flex justify-between"><span style="color:var(--text-secondary)">日志保留</span><span style="color:var(--text-primary)">{{ config?.sync.logRetentionDays ?? 30 }} 天</span></div>
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
const totalSyncs = ref(0)

interface JobSummary { id: string; startedAt: string; status: string; durationMs: number; summary: string; successSongs: number; failedSongs: number; skippedSongs: number }
interface TrackCard { id: string; title: string; artist: string; status: string }

const qualityLabels: Record<string, string> = { standard: '标准', higher: '较高', exhigh: '极高', lossless: '无损', hires: 'Hi-Res', jyeffect: '高清环绕声', jymaster: '超清母带' }
const qualityLabel = computed(() => config.value ? (qualityLabels[config.value.netease.quality] || config.value.netease.quality) : '—')

const activeStages = [
  { key: 'fetching_playlist', label: '获取歌单' },
  { key: 'comparing', label: '对比 Plex' },
  { key: 'downloading', label: '下载' },
  { key: 'processing_tags', label: '写入标签' },
  { key: 'refreshing_plex', label: '刷新 Plex' },
  { key: 'updating_plex_playlist', label: '更新歌单' },
]

const stageOrder = ['idle', 'fetching_playlist', 'comparing', 'downloading', 'processing_tags', 'refreshing_plex', 'updating_plex_playlist']
function isStageDone(key: string): boolean {
  const current = syncState.value?.currentStage
  if (!current || current === 'idle') return false
  return stageOrder.indexOf(key) < stageOrder.indexOf(current)
}

function stageDotClass(key: string): string {
  const current = syncState.value?.currentStage
  if (!current || current === 'idle') return 'bg-[var(--border-secondary)]'
  if (current === 'error') {
    const ki = stageOrder.indexOf(key)
    const doneIdx = stageOrder.indexOf('updating_plex_playlist')
    if (ki <= doneIdx) return ki < doneIdx ? 'bg-success' : 'bg-danger'
  }
  const ci = stageOrder.indexOf(current)
  const ki = stageOrder.indexOf(key)
  if (ki < ci) return 'bg-success'
  if (ki === ci) return 'bg-accent animate-pulse'
  return 'bg-[var(--border-secondary)]'
}

function stageTextColor(key: string): string {
  const current = syncState.value?.currentStage
  if (!current || current === 'idle') return 'var(--text-tertiary)'
  if (current === 'error') {
    const ki = stageOrder.indexOf(key)
    return ki < stageOrder.indexOf('updating_plex_playlist') ? 'var(--text-secondary)' : 'var(--text-primary)'
  }
  const ci = stageOrder.indexOf(current)
  const ki = stageOrder.indexOf(key)
  if (ki < ci) return 'var(--text-secondary)'
  if (ki === ci) return '#5e6ad2'
  return 'var(--text-tertiary)'
}

async function fetchData() {
  const [cfg, jobsRes, logs] = await Promise.all([
    api.get<AppConfig>('/config'),
    api.get<{ items: JobSummary[]; total: number }>('/jobs', { limit: '10' }),
    api.get<LogEntry[]>('/logs', { limit: '30' }),
  ])
  config.value = cfg
  recentJobs.value = jobsRes.items || []
  totalSyncs.value = jobsRes.total || 0
  plexOnline.value = !!cfg.plex.server
  neteaseOk.value = !!cfg.netease.cookie

  recentErrors.value = (logs || []).filter(l => l.level === 'error').slice(0, 10).map(l => {
    let songName: string | undefined
    const match = l.message?.match(/下载失败:\s*(.+)/)
    if (match) songName = match[1]
    return { ...l, songName }
  })

  const lastJob = jobsRes.items?.find(j => j.status === 'success' || j.status === 'partial' || j.status === 'failed')
  if (lastJob) {
    try {
      const detail = await api.get<{ songs: { id: string; songName: string; artist: string; status: string }[] }>(`/jobs/${lastJob.id}`)
      recentTracks.value = (detail.songs || []).filter(s => s.status === 'success' || s.status === 'failed_plex_match' || s.status === 'failed_plex_insert').slice(0, 10).map(s => ({ id: s.id, title: s.songName, artist: s.artist, status: s.status }))
    } catch { /* non-critical */ }
  }
}

async function handleSync() { try { await triggerSync(dryRun.value); startPolling(2000); await fetchData() } catch { /* handled */ } }
async function handleCancel() { try { await cancelSync(); await fetchData() } catch { /* handled */ } }

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

function formatTimeCompact(ts: string): string { return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60}s`
}

onMounted(async () => { startPolling(15000); await fetchData() })
onUnmounted(() => stopPolling())
</script>
