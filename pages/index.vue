<template>
  <div class="space-y-4">
    <!-- ═══ Connection status strip ═══ -->
    <div class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium" style="background:var(--bg-surface);border-color:var(--border-primary);color:var(--text-secondary)">
        <span class="w-2 h-2 rounded-full" :class="plexOnline ? 'bg-success' : 'bg-danger'" /> Plex {{ plexOnline ? '在线' : '离线' }}
      </div>
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium" style="background:var(--bg-surface);border-color:var(--border-primary);color:var(--text-secondary)">
        <span class="w-2 h-2 rounded-full" :class="neteaseOk ? 'bg-success' : 'bg-danger'" /> 网易云 {{ neteaseOk ? '已登录' : '未配置' }}
      </div>
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium" style="background:var(--bg-surface);border-color:var(--border-primary);color:var(--text-secondary)">
        <span class="w-2 h-2 rounded-full" :class="downloadDirOk ? 'bg-success' : 'bg-danger'" /> 下载目录 {{ downloadDirOk ? '正常' : '不可写' }}
      </div>
      <span v-if="syncState?.lastSyncAt" class="text-xs text-muted-deep">上次同步 {{ formatRelative(syncState.lastSyncAt) }}</span>

      <!-- Auto-sync toggle -->
      <button
        class="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-all duration-200"
        :style="{
          background: autoSync ? 'var(--accent-glow)' : 'var(--bg-surface)',
          borderColor: autoSync ? 'var(--accent)' : 'var(--border-primary)',
          color: autoSync ? 'var(--accent)' : 'var(--text-secondary)'
        }"
        :disabled="autoSyncLoading"
        @click="toggleAutoSync"
      >
        <span class="relative w-7 h-4 rounded-full transition-all duration-200 shrink-0" :style="{ background: autoSync ? 'var(--accent)' : 'var(--border-secondary)' }">
          <span class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform" :class="autoSync ? 'right-0.5' : 'left-0.5'" />
        </span>
        {{ autoSyncLoading ? '...' : (autoSync ? '自动同步开' : '自动同步关') }}
      </button>

      <!-- Lightweight global sync -->
      <button
        class="btn btn-primary btn-sm text-xs"
        :disabled="syncState?.isRunning || syncLoading"
        @click="handleSync"
      >立即同步</button>
    </div>

    <!-- ═══ Issue alert bar ═══ -->
    <div v-if="issueCount > 0" class="flex items-center gap-3 px-4 py-2 rounded-lg border text-xs" style="background:var(--bg-surface);border-color:var(--border-primary)">
      <span class="text-warning font-medium">⚠ {{ issueSummary }}</span>
      <NuxtLink to="/task-center?tab=failures" class="text-accent hover:underline ml-auto shrink-0">查看处理 →</NuxtLink>
    </div>

    <!-- Loading -->
    <div v-if="dashboardLoading" class="flex items-center justify-center py-20">
      <span class="text-sm text-muted">加载中...</span>
    </div>

    <!-- ═══ KPI cards ═══ -->
    <template v-else>
    <div class="grid grid-cols-4 gap-4">
      <div class="section-card p-4">
        <p class="text-2xs font-medium" style="color:var(--text-tertiary)">已下载曲目</p>
        <p class="text-xl font-semibold tracking-tight mt-0.5" style="color:var(--text-primary)">{{ downloadedTrackCount }}</p>
      </div>
      <div class="section-card p-4">
        <p class="text-2xs font-medium" style="color:var(--text-tertiary)">失败次数</p>
        <p class="text-xl font-semibold tracking-tight mt-0.5" :class="(syncState?.failureCount ?? 0) > 0 ? 'text-danger' : ''" style="color:var(--text-primary)">{{ syncState?.failureCount ?? 0 }}</p>
      </div>
      <div class="section-card p-4">
        <p class="text-2xs font-medium" style="color:var(--text-tertiary)">同步源数</p>
        <p class="text-xl font-semibold tracking-tight mt-0.5" style="color:var(--text-primary)">{{ sourceCount }}</p>
      </div>
      <div class="section-card p-4">
        <p class="text-2xs font-medium" style="color:var(--text-tertiary)">最后结果</p>
        <p class="text-xl font-semibold tracking-tight mt-0.5" :class="syncState?.lastSyncResult === 'failure' ? 'text-danger' : ''" style="color:var(--text-primary)">{{ syncState?.lastSyncResult === 'success' ? '成功' : syncState?.lastSyncResult === 'failure' ? '异常' : '未同步' }}</p>
      </div>
    </div>

    <!-- ═══ Download trend chart ═══ -->
    <div class="section-card p-4">
      <DownloadChart :data="dailyStats" :days="7" />
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { AppConfig } from '~~/server/lib/config/types'

const api = useApi()
const { state: syncState, loading: syncLoading, triggerSync, startPolling, stopPolling } = useSync()
const config = ref<AppConfig | null>(null)
const autoSync = ref(false)
const autoSyncLoading = ref(false)

async function toggleAutoSync() {
  if (!config.value) return
  autoSyncLoading.value = true
  try {
    await api.put('/config', { ...config.value, sync: { ...config.value.sync, enabled: !autoSync.value } })
    autoSync.value = !autoSync.value
  } catch { /* ignore */ }
  finally { autoSyncLoading.value = false }
}

const dailyStats = ref<{ date: string; count: number }[]>([])
const plexOnline = ref(false)
const neteaseOk = ref(false)
const downloadDirOk = ref(true)
const sourceCount = ref(0)
const downloadedTrackCount = ref(0)
const dashboardLoading = ref(true)
const failedCount = ref(0)
const copyrightCount = ref(0)

const issueCount = computed(() => failedCount.value + copyrightCount.value)
const issueSummary = computed(() => {
  const parts: string[] = []
  if (failedCount.value > 0) parts.push(`${failedCount.value} 首需处理`)
  if (copyrightCount.value > 0) parts.push(`${copyrightCount.value} 首版权受限`)
  return parts.join('，') || '暂无问题'
})

async function fetchData() {
  dashboardLoading.value = true

  const [cfg] = await Promise.all([
    api.get<AppConfig>('/config'),
  ])
  config.value = cfg
  autoSync.value = cfg.sync.enabled

  // Real health check from system stats
  try {
    const stats = await api.get<{ plexOk: boolean; neteaseOk: boolean; dirWritable: boolean }>('/system/stats')
    plexOnline.value = stats.plexOk ?? false
    neteaseOk.value = stats.neteaseOk ?? false
    downloadDirOk.value = stats.dirWritable ?? false
  } catch {
    // Fall back to config existence check
    plexOnline.value = !!cfg.plex.server
    neteaseOk.value = !!cfg.netease.cookie
    downloadDirOk.value = !!cfg.download.dir
  }

  // Source count
  try {
    const srcs = await api.get<{ length: number }[]>('/playlist-sources')
    sourceCount.value = Array.isArray(srcs) ? srcs.length : 0
  } catch { /* non-critical */ }

  // Downloaded track count
  try {
    const qs = await api.get<{ done: number }>('/downloads/queue-status')
    downloadedTrackCount.value = qs.done ?? 0
  } catch { /* non-critical */ }

  // Issue counts from failure aggregation — aligned with 失败项目 tab
  try {
    // All actionable (excludes copyright by default) + copyright separately
    const [actionableRes, copyrightRes] = await Promise.all([
      api.get<{ total: number }>('/tasks/failures', { limit: '1' }),
      api.get<{ total: number }>('/tasks/failures', { failureKind: 'copyright_restricted', limit: '1' }),
    ])
    failedCount.value = actionableRes?.total ?? 0
    copyrightCount.value = copyrightRes?.total ?? 0
  } catch { /* keep zeros */ }

  // Daily download stats for chart
  try {
    dailyStats.value = await api.get<{ date: string; count: number }[]>('/downloads/daily-stats', { days: '7' })
  } catch { /* non-critical */ }
  dashboardLoading.value = false
}

async function handleSync() {
  try { await triggerSync(false); await fetchData() } catch { /* handled */ }
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

let unsubSse: (() => void) | null = null

onMounted(async () => {
  startPolling(15000)
  await fetchData()

  // Refresh dashboard when sync finishes
  unsubSse = sseSubscribe('stage-change', (data) => {
    if (data.stage === 'idle') {
      fetchData()
    }
  })
})

onUnmounted(() => {
  stopPolling()
  if (unsubSse) unsubSse()
})
</script>
