<template>
  <div class="max-w-[1440px] space-y-8">
    <div>
      <h2 class="text-sm font-semibold">任务状态</h2>
      <p class="text-2xs text-muted mt-0.5">当前同步任务的实时运行状态</p>
    </div>

    <!-- Idle state -->
    <div v-if="!syncState?.isRunning && !syncState?.lastSyncAt" class="section-card p-8">
      <EmptyState title="暂无任务" description="点击仪表盘的「手动同步」按钮开始第一次同步" />
    </div>

    <!-- Running state -->
    <template v-if="syncState?.isRunning">
      <!-- Stage indicator -->
      <div class="section-card p-6">
        <div class="flex items-center gap-4 mb-4">
          <div class="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span class="text-sm font-semibold">同步进行中</span>
          <span v-if="syncState.dryRun" class="text-2xs px-1.5 py-0.5 bg-warning/20 text-warning rounded">预览模式</span>
        </div>

        <!-- Stage steps -->
        <div class="space-y-2">
          <div
            v-for="(stage, idx) in stages"
            :key="stage.key"
            class="flex items-center gap-4"
          >
            <div
              class="w-6 h-6 rounded-full flex items-center justify-center text-2xs shrink-0"
              :class="stageClass(stage.key, idx)"
            >
              <span v-if="isStageDone(stage.key, idx)">&#10003;</span>
              <span v-else-if="isStageCurrent(stage.key, idx)" class="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              <span v-else class="text-muted-deep">{{ idx + 1 }}</span>
            </div>
            <span
              class="text-sm"
              :class="isStageCurrent(stage.key, idx) ? 'text-[var(--text-primary)] font-medium' : isStageDone(stage.key, idx) ? 'text-muted' : 'text-muted-deep'"
            >{{ stage.label }}</span>
          </div>
        </div>
      </div>

      <!-- Progress bar -->
      <div v-if="syncState.progress" class="section-card p-5">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm text-muted">下载进度</span>
          <span class="text-sm font-mono">{{ syncState.progress.current }} / {{ syncState.progress.total }}</span>
        </div>
        <div class="w-full h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
          <div
            class="h-full bg-accent rounded-full transition-all duration-300"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <p v-if="syncState.currentSong" class="text-2xs text-muted mt-2">当前: {{ syncState.currentSong }}</p>
      </div>

      <!-- Cancel button -->
      <div class="flex justify-end">
        <button class="btn btn-danger" @click="handleCancel">
          取消任务
        </button>
      </div>
    </template>

    <!-- Completed state -->
    <template v-if="!syncState?.isRunning && syncState?.lastSyncAt">
      <div class="section-card p-5">
        <div class="flex items-center gap-2 mb-4">
          <SidebarIcon :name="syncState.lastSyncResult === 'success' ? 'check' : 'warn'" :active="syncState.lastSyncResult === 'success'" />
          <span class="text-sm font-semibold">
            {{ syncState.lastSyncResult === 'success' ? '上次同步成功' : '上次同步失败' }}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-muted">完成时间</span>
            <p class="text-[var(--text-primary)] mt-0.5">{{ formatDateTime(syncState.lastSyncAt) }}</p>
          </div>
          <div>
            <span class="text-muted">累计同步</span>
            <p class="text-[var(--text-primary)] mt-0.5">{{ syncState.syncCount }} 次</p>
          </div>
        </div>
      </div>

      <!-- Failures list -->
      <div v-if="syncState.failures.length > 0" class="section-card overflow-hidden">
        <div class="px-5 py-3 border-b border-[var(--border-primary)]">
          <h3 class="text-sm font-semibold text-danger">失败项目 ({{ syncState.failures.length }})</h3>
        </div>
        <div class="divide-y divide-[var(--border-primary)]">
          <div v-for="(f, i) in syncState.failures" :key="i" class="px-5 py-3 flex items-start justify-between">
            <div>
              <p class="text-sm">{{ f.songName }}</p>
              <p class="text-2xs text-muted mt-0.5">{{ f.reason }}</p>
            </div>
            <span class="text-2xs text-muted-deep">{{ formatDateTime(f.timestamp) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const { state: syncState, cancelSync, startPolling, stopPolling } = useSync()

const stages = [
  { key: 'fetching_playlist', label: '获取歌单' },
  { key: 'comparing', label: '对比歌曲' },
  { key: 'downloading', label: '下载歌曲' },
  { key: 'processing_tags', label: '写入元数据' },
  { key: 'refreshing_plex', label: '刷新 Plex 库' },
  { key: 'updating_plex_playlist', label: '更新 Plex 歌单' },
]

const stageOrder = stages.map(s => s.key)
const currentStageIdx = computed(() => stageOrder.indexOf(syncState.value?.currentStage ?? ''))

function isStageDone(stageKey: string, idx: number): boolean {
  return currentStageIdx.value > idx || (syncState.value?.lastSyncResult === 'success' && !syncState.value?.isRunning)
}
function isStageCurrent(stageKey: string, idx: number): boolean {
  return syncState.value?.isRunning && currentStageIdx.value === idx
}

function stageClass(stageKey: string, idx: number): string {
  if (isStageDone(stageKey, idx)) return 'bg-accent text-white'
  if (isStageCurrent(stageKey, idx)) return 'bg-accent-muted text-accent border border-accent'
  return 'bg-[var(--bg-surface)] text-muted-deep'
}

const progressPercent = computed(() => {
  const p = syncState.value?.progress
  if (!p || p.total === 0) return 0
  return Math.round((p.current / p.total) * 100)
})

async function handleCancel() {
  await cancelSync()
}

function formatDateTime(ts: string): string {
  return new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Adaptive polling: fast when sync is running, slow when idle
const pollInterval = computed(() => syncState.value?.isRunning ? 2000 : 15000)

onMounted(() => startPolling(pollInterval.value))
onUnmounted(() => stopPolling())

watch(pollInterval, (ms) => {
  stopPolling()
  startPolling(ms)
})
</script>
