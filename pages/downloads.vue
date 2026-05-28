<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-sm font-semibold">下载中心</h2>
        <p class="text-2xs text-muted mt-0.5">实时同步进度 & 下载历史</p>
      </div>
      <div class="flex items-center gap-3">
        <button v-if="activeTab === 'history'" class="btn btn-danger" @click="showClear = true">清空历史</button>
        <button class="btn btn-secondary" @click="activeTab === 'sync' ? fetchSyncState() : refreshAll()">刷新</button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-1">
      <button v-for="t in tabs" :key="t.key"
        class="px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer"
        :class="activeTab === t.key
          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium'
          : 'text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'"
        @click="activeTab = t.key"
      >{{ t.label }}</button>
    </div>

    <!-- ═══ Tab: Sync Tasks ═══ -->
    <template v-if="activeTab === 'sync'">
      <!-- Sync status module (always visible) -->
      <div class="section-card overflow-hidden">
        <!-- Loading -->
        <div v-if="syncLoading" class="px-5 py-4 flex items-center gap-2">
          <span class="text-xs text-muted">加载中...</span>
        </div>

        <!-- Expanded: running -->
        <div v-else-if="isSyncing" class="p-5">
          <div class="flex items-center gap-2 mb-3">
            <span class="w-2.5 h-2.5 rounded-full bg-accent animate-pulse shrink-0" />
            <span class="text-sm font-semibold" style="color:var(--text-primary)">同步进行中</span>
            <span class="text-2xs px-2 py-0.5 rounded" style="background:var(--accent-glow);color:var(--accent)">
              {{ stageLabel(syncState?.currentStage || 'idle') }}
            </span>
            <span v-if="currentSourceName" class="text-xs text-muted">· {{ currentSourceName }}</span>
          </div>

          <!-- Current song -->
          <div v-if="syncState?.currentSong" class="flex items-center gap-1.5 mb-2 text-xs" style="color:var(--text-secondary)">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#9d9d9d" stroke-width="1.2"/><path d="M7 5.5v5l3.5-2.5L7 5.5z" fill="#9d9d9d"/></svg>
            <span class="truncate">{{ syncState?.currentSong }}</span>
          </div>

          <!-- Stage steps -->
          <div class="flex items-center gap-1 mb-3">
            <template v-for="(stage, idx) in activeStages" :key="stage.key">
              <span class="w-2 h-2 rounded-full shrink-0" :class="syncStageDot(stage.key)" />
              <span class="text-2xs shrink-0" :style="{ color: syncStageColor(stage.key) }" :class="syncState?.currentStage === stage.key ? 'font-medium' : ''">{{ stage.label }}</span>
              <svg v-if="idx < activeStages.length - 1" width="10" height="10" viewBox="0 0 10 10" fill="none" class="shrink-0">
                <path d="M3.5 2l3 3-3 3" :stroke="isStageDone(idx + 1) ? 'var(--accent)' : 'var(--border-secondary)'" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </template>
          </div>

          <!-- Progress bar -->
          <div class="w-full h-2 rounded-full overflow-hidden" style="background:var(--bg-input)">
            <div class="h-full rounded-full transition-all duration-500 bg-accent"
              :style="{ width: overallPct + '%' }" />
          </div>
          <div class="flex justify-between mt-1.5">
            <span class="text-2xs text-muted-deep">{{ completedCount }} / {{ totalCount }} 首</span>
            <span class="text-2xs text-muted-deep">{{ overallPct }}%</span>
          </div>
        </div>

        <!-- Collapsed: idle -->
        <div v-else class="px-5 py-3 flex items-center gap-3">
          <span class="w-2 h-2 rounded-full shrink-0" :class="lastSyncDot" />
          <span class="text-xs font-medium" style="color:var(--text-primary)">同步状态</span>
          <span class="text-2xs text-muted-deep">空闲</span>
          <span class="flex-1" />
          <span class="text-2xs text-muted-deep">{{ lastSyncSummary }}</span>
        </div>
      </div>

      <!-- Source groups -->
      <div v-if="sourceGroups.length > 0" class="space-y-4">
        <!-- Toggle detail -->
        <div class="flex items-center justify-end">
          <button
            class="text-2xs px-2 py-1 rounded cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
            style="color:var(--text-tertiary)"
            @click="showSongDetail = !showSongDetail"
          >{{ showSongDetail ? '收起详情' : '展开详情' }}</button>
        </div>
        <div v-for="g in sourceGroups" :key="g.sourceId" class="section-card overflow-hidden">
          <!-- Group header -->
          <div class="px-5 py-3 flex items-center gap-3 border-b border-[var(--border-primary)]" :style="showSongDetail ? { background: 'var(--bg-app)' } : { background: 'var(--bg-app)', borderBottom: 'none' }">
            <span class="text-xs font-medium">{{ g.sourceName }}</span>
            <span class="text-2xs text-muted">{{ g.doneCount }}/{{ g.totalCount }} 完成</span>
            <div class="flex-1 ml-4">
              <div class="h-1 rounded-full overflow-hidden" style="background:var(--bg-input)">
                <div class="h-full rounded-full transition-all duration-300 bg-accent"
                  :style="{ width: g.progressPct + '%' }" />
              </div>
            </div>
          </div>
          <!-- Song rows (collapsible) -->
          <div v-if="showSongDetail" class="divide-y divide-[var(--border-primary)]">
            <div v-for="song in g.songs" :key="song.taskId"
              class="px-5 py-2.5 flex items-center gap-4 text-xs"
            >
              <!-- Status icon -->
              <span class="shrink-0">
                <span v-if="song.status === 'done'" class="text-success">●</span>
                <span v-else-if="song.status === 'failed'" class="text-danger">✕</span>
                <span v-else-if="song.status === 'downloading' || song.status === 'tagging'" class="text-accent">◉</span>
                <span v-else class="text-muted-deep">○</span>
              </span>
              <span class="flex-1 truncate" style="color:var(--text-primary)">{{ song.songName }}</span>
              <!-- Progress mini bar -->
              <div v-if="song.status === 'downloading' || song.status === 'tagging'" class="w-20 shrink-0">
                <div class="h-1 rounded-full overflow-hidden" style="background:var(--bg-input)">
                  <div class="h-full rounded-full transition-all" :class="song.status === 'tagging' ? 'bg-warning' : 'bg-accent'"
                    :style="{ width: song.progress + '%' }" />
                </div>
              </div>
              <span class="text-2xs shrink-0 w-14 text-right" :class="songStatusColor(song.status)">{{ songStatusLabel(song.status) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent sync summary (when idle) -->
      <div v-if="!syncState?.isRunning && sourceGroups.length === 0 && lastSyncSources.length > 0" class="section-card p-5">
        <p class="text-xs font-medium mb-4" style="color:var(--text-primary)">最近同步</p>
        <div class="space-y-3">
          <div v-for="s in lastSyncSources" :key="s.id" class="flex items-center gap-3">
            <span class="w-2 h-2 rounded-full shrink-0"
              :class="s.lastStatus === 'success' ? 'bg-success' : s.lastStatus === 'partial' ? 'bg-warning' : 'bg-danger'" />
            <span class="text-sm flex-1" style="color:var(--text-primary)">{{ s.name }}</span>
            <span class="text-2xs text-muted">{{ s.trackCount }} 首</span>
            <span v-if="s.lastSyncedAt" class="text-2xs font-mono" style="color:var(--text-tertiary)">{{ formatTimeFull(s.lastSyncedAt) }}</span>
            <span class="text-xs" :class="s.lastStatus === 'success' ? 'text-success' : s.lastStatus === 'partial' ? 'text-warning' : 'text-danger'">
              {{ s.lastStatus === 'success' ? '成功' : s.lastStatus === 'partial' ? '部分失败' : '失败' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Empty -->
      <div v-if="!syncState?.isRunning && sourceGroups.length === 0 && lastSyncSources.length === 0" class="section-card p-8">
        <EmptyState title="暂无同步记录" description="执行同步后，进度和结果将显示在这里" />
      </div>
    </template>

    <!-- ═══ Tab: History ═══ -->
    <template v-if="activeTab === 'history'">
      <!-- Filter bar (always visible) -->
      <div class="flex items-center justify-between gap-3">
        <span class="text-2xs text-muted-deep shrink-0">共 {{ historyTotal }} 条</span>
        <div class="flex items-center gap-2">
          <input
            v-model="historySearch"
            type="text"
            placeholder="搜索歌名..."
            class="form-input w-36 text-xs"
            @input="onHistorySearch"
          />
          <DateRange v-model="dateFilter" :min-date="historyEarliestDate" />
        </div>
      </div>

      <div v-if="loading" class="flex items-center justify-center py-16">
        <span class="text-muted text-sm">加载中...</span>
      </div>
      <div v-else-if="historyItems.length === 0" class="section-card p-8">
        <EmptyState title="暂无下载记录" description="执行同步任务后，已完成的下载记录将显示在这里" />
      </div>
      <div v-else class="space-y-3">
        <div class="section-card overflow-hidden">
          <div class="divide-y divide-[var(--border-primary)]">
            <div v-for="d in historyItems" :key="d.id"
              class="px-5 py-3 flex items-start gap-4 hover:bg-[var(--bg-hover)] transition-colors">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-xs" :class="d.status === 'done' ? 'text-success' : 'text-danger'">{{ d.status === 'done' ? '✓' : '✗' }}</span>
                  <p class="text-sm truncate" style="color:var(--text-primary)">{{ d.songName }}</p>
                </div>
                <p class="text-2xs text-muted-deep mt-0.5 truncate">{{ d.artist }} · {{ d.album }}</p>
                <p v-if="d.filePath" class="text-2xs text-muted-deep mt-0.5 truncate font-mono" :title="d.filePath">{{ d.filePath }}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0 pt-0.5">
                <span v-if="d.quality" class="text-2xs px-1.5 py-0.5 rounded text-muted" style="background:var(--bg-input)">{{ qualityLabel(d.quality) }}</span>
                <span v-if="d.fileType" class="text-2xs px-1.5 py-0.5 rounded text-muted" style="background:var(--bg-input)">{{ d.fileType.toUpperCase() }}</span>
              </div>
              <span class="text-2xs text-muted-deep shrink-0 text-right pt-0.5 whitespace-nowrap">{{ formatTimeFull(d.updatedAt) }}</span>
            </div>
          </div>
        </div>
        <Pagination
          :has-more="historyHasMore" :loading="historyLoadingMore"
          :current-count="historyItems.length" :total="historyTotal"
          @load-more="loadMoreHistory" />
      </div>
    </template>

    <ConfirmDialog :visible="showClear" title="清空下载历史" message="确定要清空所有下载历史记录吗？" confirm-label="清空" variant="danger"
      @confirm="handleClear" @cancel="showClear = false" />
  </div>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'

const api = useApi()
const { state: syncState } = useSyncStatus()
const {
  historyItems, historyEarliestDate, historyTotal, historyHasMore, historyLoadingMore, loadMoreHistory,
  dateFilter, historySearch, clearAll, fetchAll: refreshAll,
} = useDownloadQueue()

const activeTab = ref<'sync' | 'history'>('sync')
const showClear = ref(false)
const loading = ref(false)
const currentSourceName = ref('')

// ── Real-time sync task state ──
interface SyncTaskEntry {
  taskId: string; sourceId: string; songName: string
  status: string; progress: number
}
const syncTasks = ref<SyncTaskEntry[]>([])
const sourceNameMap = ref<Record<string, string>>({})

const isSyncing = computed(() => syncState.value?.isRunning || (syncState.value?.currentStage && syncState.value.currentStage !== 'idle'))

const lastSyncedSource = computed(() => {
  const synced = lastSyncSources.value.filter(s => s.lastSyncedAt)
  if (synced.length === 0) return null
  return synced.reduce((a, b) => (a.lastSyncedAt! > b.lastSyncedAt! ? a : b))
})
const lastSyncDot = computed(() => {
  const s = lastSyncedSource.value
  if (!s) return 'bg-muted-deep'
  return s.lastStatus === 'success' ? 'bg-success' : s.lastStatus === 'partial' ? 'bg-warning' : 'bg-danger'
})
const lastSyncSummary = computed(() => {
  const s = lastSyncedSource.value
  if (!s?.lastSyncedAt) return ''
  return `${s.lastStatus === 'success' ? '成功' : s.lastStatus === 'partial' ? '部分失败' : '失败'} · ${formatTimeFull(s.lastSyncedAt)}`
})

const stageOrder = ['idle', 'fetching_playlist', 'comparing', 'downloading', 'processing_tags', 'refreshing_plex', 'updating_plex_playlist']
const activeStages = [
  { key: 'fetching_playlist', label: '获取歌单' },
  { key: 'comparing', label: '对比 Plex' },
  { key: 'downloading', label: '下载' },
  { key: 'processing_tags', label: '写入标签' },
  { key: 'refreshing_plex', label: '刷新 Plex' },
  { key: 'updating_plex_playlist', label: '更新歌单' },
]

function syncStageDot(key: string): string {
  const current = syncState.value?.currentStage
  if (!current || current === 'idle') return 'bg-[var(--border-secondary)]'
  const ci = stageOrder.indexOf(current)
  const ki = stageOrder.indexOf(key)
  if (ki < ci) return 'bg-success'
  if (ki === ci) return 'bg-accent animate-pulse'
  return 'bg-[var(--border-secondary)]'
}
function syncStageColor(key: string): string {
  const current = syncState.value?.currentStage
  if (!current || current === 'idle') return 'var(--text-tertiary)'
  const ci = stageOrder.indexOf(current)
  const ki = stageOrder.indexOf(key)
  if (ki < ci) return 'var(--text-secondary)'
  if (ki === ci) return 'var(--accent)'
  return 'var(--text-tertiary)'
}
function isStageDone(idx: number): boolean {
  const current = syncState.value?.currentStage
  if (!current || current === 'idle') return false
  return idx <= stageOrder.indexOf(current)
}

const totalCount = computed(() => syncTasks.value.length || 1)
const overallPct = computed(() => {
  if (syncTasks.value.length === 0) return 0
  const total = syncTasks.value.reduce((sum, t) => {
    if (t.status === 'done' || t.status === 'failed') return sum + 100
    if (t.status === 'downloading' || t.status === 'tagging') return sum + t.progress
    return sum
  }, 0)
  return Math.round(total / syncTasks.value.length)
})
const completedCount = computed(() => syncTasks.value.filter(t => t.status === 'done' || t.status === 'failed').length)

interface SourceGroup { sourceId: string; sourceName: string; doneCount: number; totalCount: number; progressPct: number; songs: SyncTaskEntry[] }
const sourceGroups = computed<SourceGroup[]>(() => {
  const map = new Map<string, SyncTaskEntry[]>()
  for (const t of syncTasks.value) {
    const key = t.sourceId || '__unknown__'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  return Array.from(map.entries()).map(([sourceId, songs]) => {
    const total = songs.reduce((sum, s) => {
      if (s.status === 'done' || s.status === 'failed') return sum + 100
      if (s.status === 'downloading' || s.status === 'tagging') return sum + s.progress
      return sum
    }, 0)
    return {
      sourceId,
      sourceName: sourceNameMap.value[sourceId] || sourceId.slice(0, 8),
      doneCount: songs.filter(s => s.status === 'done').length,
      totalCount: songs.length,
      progressPct: songs.length > 0 ? Math.round(total / songs.length) : 0,
      songs,
    }
  })
})

const lastSyncSources = ref<PlaylistSource[]>([])
const syncLoading = ref(true)

// ── Fetch source names + initial state ──
async function fetchSyncState() {
  syncLoading.value = true
  // Load source name map
  try {
    const srcs = await api.get<PlaylistSource[]>('/playlist-sources')
    for (const s of srcs) sourceNameMap.value[s.id] = s.name
    lastSyncSources.value = srcs.filter(s => s.lastSyncedAt)
  } catch { /* ignore */ }

  // Load active tasks
  try {
    const active = await api.get<{ items: SyncTaskEntry[] }>('/downloads/tasks', { status: 'pending,downloading,tagging', limit: '200' })
    syncTasks.value = active.items.map((t: any) => ({
      taskId: t.id, sourceId: t.sourceId, songName: t.songName, status: t.status, progress: t.progress ?? 0,
    }))
  } catch { /* ignore */ }
  syncLoading.value = false
}

// ── SSE handlers ──
const unsubs: Array<() => void> = []

function handleQueueUpdate(data: Record<string, unknown>) {
  const { taskId, songName, status, sourceId, progress } = data
  if (typeof taskId !== 'string') return
  const existing = syncTasks.value.find(t => t.taskId === taskId)
  if (existing) {
    existing.status = status as string
    if (typeof progress === 'number') existing.progress = progress
  } else if (status === 'downloading' || status === 'pending') {
    syncTasks.value.push({
      taskId, sourceId: (sourceId as string) || '', songName: (songName as string) || '',
      status: (status as string), progress: typeof progress === 'number' ? progress : 0,
    })
  }
}

function handleSongProgress(data: Record<string, unknown>) {
  const { taskId, songName, status, sourceId } = data
  if (typeof taskId !== 'string') return
  const existing = syncTasks.value.find(t => t.taskId === taskId)
  if (existing) {
    existing.status = status as string
    existing.progress = status === 'done' ? 100 : existing.progress
  }
}

function handleStageChange(data: Record<string, unknown>) {
  if (data.sourceName) currentSourceName.value = data.sourceName as string
  // When stage changes to idle, sync is done — reload source states
  if (data.stage === 'idle') {
    setTimeout(async () => {
      try {
        const srcs = await api.get<PlaylistSource[]>('/playlist-sources')
        lastSyncSources.value = srcs.filter(s => s.lastSyncedAt)
      } catch { /* ignore */ }
      // Clear active tasks after a short delay
      syncTasks.value = syncTasks.value.filter(t => t.status === 'failed')
    }, 2000)
  }
}

onMounted(() => {
  fetchSyncState()
  unsubs.push(sseSubscribe('queue-update', handleQueueUpdate))
  unsubs.push(sseSubscribe('song-progress', handleSongProgress))
  unsubs.push(sseSubscribe('stage-change', handleStageChange))
})

onUnmounted(() => { for (const u of unsubs) u() })

// ── History tab ──
async function handleClear() { showClear.value = false; await clearAll() }

const qualityLabels: Record<string, string> = { standard:'标准', higher:'较高', exhigh:'极高', lossless:'无损', hires:'Hi-Res', jyeffect:'高清环绕声', jymaster:'超清母带' }
function qualityLabel(l: string): string { return qualityLabels[l] || l }

const stageLabels: Record<string, string> = {
  idle:'空闲', fetching_playlist:'获取歌单', comparing:'对比歌曲', downloading:'下载歌曲',
  processing_tags:'写入元数据', refreshing_plex:'刷新 Plex 库', updating_plex_playlist:'更新 Plex 歌单',
  reorder:'重排歌单', cancelled:'已取消', error:'同步错误',
}
function stageLabel(s: string): string { return stageLabels[s] || s }
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

function songStatusLabel(s: string): string {
  switch (s) { case 'pending': return '排队'; case 'downloading': return '下载中'; case 'tagging': return '写标签'; case 'done': return '完成'; case 'failed': return '失败'; default: return s }
}
function songStatusColor(s: string): string {
  switch (s) { case 'downloading': return 'text-accent'; case 'tagging': return 'text-warning'; case 'done': return 'text-success'; case 'failed': return 'text-danger'; default: return 'text-muted-deep' }
}

const tabs = [{ key: 'sync' as const, label: '实时同步进度' }, { key: 'history' as const, label: '下载历史' }]
const showSongDetail = ref(true)

let historySearchTimer: ReturnType<typeof setTimeout> | null = null
function onHistorySearch() {
  if (historySearchTimer) clearTimeout(historySearchTimer)
  historySearchTimer = setTimeout(() => refreshAll(), 300)
}

function formatTimeFull(ts: string): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${dd} ${h}:${mi}:${ss}`
}

watch(dateFilter, () => refreshAll(), { deep: true })
</script>
