<template>
  <div class="max-w-[1600px] space-y-8">
    <!-- Status cards -->
    <div class="grid grid-cols-4 gap-4">
      <StatusCard label="同步状态" :value="statusText" :trend="statusTrend" />
      <StatusCard label="成功次数" :value="String(syncState?.successCount ?? 0)" />
      <StatusCard label="失败次数" :value="String(syncState?.failureCount ?? 0)" :trend="failureTrend" />
      <StatusCard label="上次同步" :value="lastSyncText" />
    </div>

    <!-- Quick actions -->
    <div class="bg-surface border border-[var(--border-primary)] rounded-xl p-5">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-base font-semibold">同步操作</h2>
          <p class="text-sm text-muted mt-1">手动触发一次同步任务，或使用预览模式查看差异</p>
        </div>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
            <input
              v-model="dryRun"
              type="checkbox"
              class="w-4 h-4 rounded border-[var(--border-secondary)] bg-[var(--bg-surface)] text-accent focus:ring-accent cursor-pointer"
            />
            预览模式
          </label>
          <button
            class="btn btn-primary btn-lg"
            :disabled="syncState?.isRunning || syncLoading"
            @click="handleSync"
          >
            <SidebarIcon :name="syncState?.isRunning ? 'stop' : 'sync'" :active="false" />
            {{ syncLoading ? '触发中...' : syncState?.isRunning ? '正在同步' : dryRun ? '预览同步' : '手动同步' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Config summary + Recent logs -->
    <div class="grid grid-cols-2 gap-6">
      <!-- Config summary -->
      <div class="bg-surface border border-[var(--border-primary)] rounded-xl p-5">
        <h2 class="text-sm font-semibold mb-4">当前配置</h2>
        <div v-if="config" class="space-y-3">
          <ConfigRow label="网易云歌单" :value="config.netease.playlistIds.length ? `${config.netease.playlistIds.length} 个歌单` : '未配置'" />
          <ConfigRow label="音质" :value="qualityLabel" />
          <ConfigRow label="Plex 服务器" :value="config.plex.server || '未配置'" />
          <ConfigRow label="Plex 库" :value="config.plex.section" />
          <ConfigRow label="下载目录" :value="config.download.dir" />
          <ConfigRow label="同步间隔" :value="`${config.sync.intervalMinutes} 分钟`" />
          <ConfigRow label="自动同步" :value="config.sync.enabled ? '已启用' : '已禁用'" />
        </div>
        <div v-else class="flex items-center justify-center py-8">
          <span class="text-muted text-sm">加载中...</span>
        </div>
      </div>

      <!-- Recent logs -->
      <div class="bg-surface border border-[var(--border-primary)] rounded-xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold">最近日志</h2>
          <NuxtLink to="/jobs" class="text-xs text-accent hover:text-accent-hover transition-colors">查看全部</NuxtLink>
        </div>
        <div v-if="recentLogs.length > 0" class="space-y-2">
          <div
            v-for="log in recentLogs.slice(0, 8)"
            :key="log.id"
            class="flex items-start gap-2 text-sm"
          >
            <span class="mt-0.5 shrink-0" :class="logLevelColor(log.level)">&bull;</span>
            <span class="text-[var(--text-primary)] truncate">{{ log.message }}</span>
            <span class="text-2xs text-muted-deep shrink-0 ml-auto">{{ formatLogTime(log.timestamp) }}</span>
          </div>
        </div>
        <EmptyState v-else title="暂无日志" description="执行同步后日志将显示在这里" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AppConfig } from '~~/server/lib/config/types'
import type { LogEntry } from '~~/server/lib/log/types'

const api = useApi()
const { state: syncState, loading: syncLoading, triggerSync, startPolling, stopPolling, fetchStatus } = useSync()

const config = ref<AppConfig | null>(null)
const recentLogs = ref<LogEntry[]>([])
const dryRun = ref(false)

const qualityLabels: Record<string, string> = {
  standard: '标准', higher: '较高', exhigh: '极高',
  lossless: '无损', hires: 'Hi-Res', jyeffect: '高清环绕声', jymaster: '超清母带',
}
const qualityLabel = computed(() => config.value ? (qualityLabels[config.value.netease.quality] || config.value.netease.quality) : '-')

const statusText = computed(() => {
  if (syncState.value?.isRunning) return '同步中'
  if (!syncState.value?.lastSyncAt) return '待首次同步'
  return syncState.value.lastSyncResult === 'success' ? '正常' : '异常'
})
const statusTrend = computed(() => {
  if (syncState.value?.isRunning) return undefined
  return syncState.value?.lastSyncResult === 'success' ? 'ok' : syncState.value?.lastSyncResult === 'failure' ? 'error' : undefined
})
const failureTrend = computed(() => {
  const count = syncState.value?.failureCount ?? 0
  return count > 0 ? 'error' : undefined
})
const lastSyncText = computed(() => {
  if (!syncState.value?.lastSyncAt) return '从未'
  return formatTime(syncState.value.lastSyncAt)
})

async function handleSync() {
  try {
    await triggerSync(dryRun.value)
    await fetchData()
  } catch { /* handled in composable */ }
}

async function fetchData() {
  const [cfg, logs] = await Promise.all([
    api.get<AppConfig>('/config'),
    api.get<LogEntry[]>('/logs', { limit: '20' }),
  ])
  config.value = cfg
  recentLogs.value = logs
}

function logLevelColor(level: string): string {
  switch (level) {
    case 'error': return 'text-danger'
    case 'warn': return 'text-warning'
    default: return 'text-muted'
  }
}

function formatLogTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

onMounted(async () => {
  startPolling(15000)
  await fetchData()
})
onUnmounted(() => stopPolling())
</script>
