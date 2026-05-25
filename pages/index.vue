<template>
  <div class="max-w-[1200px] space-y-5">
    <!-- Status cards -->
    <div class="grid grid-cols-4 gap-3">
      <StatusCard label="同步状态" :value="statusText" :trend="statusTrend" />
      <StatusCard label="成功次数" :value="String(syncState?.successCount ?? 0)" />
      <StatusCard label="失败次数" :value="String(syncState?.failureCount ?? 0)" :trend="failureTrend" />
      <StatusCard label="上次同步" :value="lastSyncText" />
    </div>

    <!-- Sync action -->
    <div class="section-card p-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-semibold" style="color:var(--text-primary)">同步操作</p>
          <p class="text-xs mt-0.5" style="color:var(--text-secondary)">手动触发同步任务，或使用预览模式查看差异</p>
        </div>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-1.5 text-xs cursor-pointer select-none" style="color:var(--text-secondary)">
            <input v-model="dryRun" type="checkbox" class="w-3.5 h-3.5 rounded accent-[#5e6ad2] cursor-pointer" />
            预览
          </label>
          <button class="btn btn-primary" :disabled="syncState?.isRunning || syncLoading" @click="handleSync">
            {{ syncLoading ? '触发中...' : syncState?.isRunning ? '同步中' : dryRun ? '预览同步' : '手动同步' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Config + Recent activity -->
    <div class="grid grid-cols-2 gap-4">
      <div class="section-card p-4">
        <p class="text-sm font-semibold mb-3" style="color:var(--text-primary)">当前配置</p>
        <div v-if="config" class="space-y-2">
          <ConfigRow label="网易云歌单" :value="config.netease.playlistIds.length ? `${config.netease.playlistIds.length} 个` : '未配置'" />
          <ConfigRow label="音质" :value="qualityLabel" />
          <ConfigRow label="Plex 服务器" :value="config.plex.server || '未配置'" />
          <ConfigRow label="Plex 库" :value="config.plex.section" />
          <ConfigRow label="下载目录" :value="config.download.dir" />
          <ConfigRow label="自动同步" :value="config.sync.enabled ? '已启用' : '已禁用'" />
        </div>
        <div v-else class="flex items-center justify-center py-6">
          <span class="text-xs" style="color:var(--text-tertiary)">加载中...</span>
        </div>
      </div>

      <div class="section-card p-4">
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm font-semibold" style="color:var(--text-primary)">最近活动</p>
          <NuxtLink to="/jobs" class="text-xs hover:underline" style="color:var(--text-secondary)">查看全部</NuxtLink>
        </div>
        <div v-if="recentLogs.length > 0" class="space-y-1">
          <div v-for="log in recentLogs.slice(0, 7)" :key="log.id" class="flex items-center gap-2 text-xs py-0.5">
            <span class="shrink-0" :class="logLevelColor(log.level)">&bull;</span>
            <span class="truncate flex-1" style="color:var(--text-secondary)">{{ log.message }}</span>
            <span class="shrink-0 text-2xs font-mono" style="color:var(--text-tertiary)">{{ formatLogTime(log.timestamp) }}</span>
          </div>
        </div>
        <EmptyState v-else title="暂无活动" description="执行同步后记录将显示在这里" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AppConfig } from '~~/server/lib/config/types'
import type { LogEntry } from '~~/server/lib/log/types'

const api = useApi()
const { state: syncState, loading: syncLoading, triggerSync, startPolling, stopPolling } = useSync()

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
  try { await triggerSync(dryRun.value); await fetchData() } catch { /* handled */ }
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
    default: return 'text-[var(--text-tertiary)]'
  }
}

function formatLogTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
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

onMounted(async () => { startPolling(15000); await fetchData() })
onUnmounted(() => stopPolling())
</script>
