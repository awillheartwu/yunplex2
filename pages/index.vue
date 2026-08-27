<template>
  <div class="dashboard-page">
    <section v-if="summary" class="section-card dashboard-toolbar" aria-label="首页状态与同步操作">
      <div class="dashboard-toolbar__status">
        <strong>同步概览</strong>
        <span class="dashboard-toolbar__timestamp">{{ formatDashboardLastSyncLabel(summary.status.lastSyncAt) }}</span>
      </div>

      <div class="dashboard-toolbar__actions">
        <button class="dashboard-toggle" :class="summary.status.autoSyncEnabled ? 'dashboard-toggle--active' : ''" :disabled="autoSyncLoading" type="button" @click="toggleAutoSync">
          <span class="dashboard-toggle__track"><span class="dashboard-toggle__thumb" :class="summary.status.autoSyncEnabled ? 'dashboard-toggle__thumb--active' : ''" /></span>
          <span>{{ autoSyncLoading ? '切换中...' : summary.status.autoSyncEnabled ? '自动同步已开启' : '自动同步已关闭' }}</span>
        </button>
        <button class="btn btn-primary dashboard-sync-button" :disabled="syncState?.isRunning || syncLoading" type="button" @click="handleSync">
          {{ syncState?.isRunning || syncLoading ? '同步中...' : '立即同步' }}
        </button>
      </div>
    </section>

    <section class="dashboard-monitor" aria-label="系统状态">
      <SystemMonitorPanel
        :dependency-checked-label="dependencyCheckedLabel"
        :health-items="healthItems"
        :health-refreshing="healthRefreshing"
        :kpi-cards="kpiCards"
        :overall-tone="overallTone"
        @refresh-health="refreshDependencyHealth"
        @copy-diagnostics="copyDiagnostics"
      />
    </section>

    <div v-if="dashboardLoading" class="section-card dashboard-feedback"><p>加载中</p></div>
    <div v-else-if="dashboardError" class="section-card dashboard-feedback dashboard-feedback--error">
      <strong>首页数据暂时不可用</strong>
      <p>{{ dashboardError }}</p>
      <button class="btn btn-secondary btn-sm" type="button" @click="refreshDashboard">重新加载</button>
    </div>

    <template v-else-if="summary">
      <NuxtLink v-if="syncState?.isRunning" to="/task-center" class="section-card dashboard-current-task">
        <span class="dashboard-current-task__icon"><AppIcon name="activity" :size="17" /></span>
        <div>
          <strong>同步正在执行</strong>
          <p>{{ syncState.currentSourceName || syncState.currentSong || '正在处理同步源' }}</p>
        </div>
        <span>查看任务中心 <AppIcon name="arrowRight" :size="14" /></span>
      </NuxtLink>

      <div class="dashboard-workspace">
        <DashboardPendingList :items="summary.pendingItems" />
        <DashboardSourceHealth :summary="summary.sourceHealth" />
      </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import type { AppConfig } from '~~/server/lib/config/types'
import type { DashboardSummary } from '~~/types/dashboard'
import { formatDashboardLastSyncLabel } from '~~/composables/useDashboardFormat'
import { useFeedback } from '~~/composables/useFeedback'
import { useSystemMonitor } from '~~/composables/useSystemMonitor'

const api = useApi()
const feedback = useFeedback()
const { state: syncState, loading: syncLoading, triggerSync, startPolling, stopPolling } = useSync()
const summary = ref<DashboardSummary | null>(null)
const dashboardLoading = ref(true)
const dashboardError = ref<string | null>(null)
const autoSyncLoading = ref(false)
const config = ref<AppConfig | null>(null)
const {
  copyDiagnostics,
  dependencyCheckedLabel,
  healthItems,
  healthRefreshing,
  kpiCards,
  overallTone,
  refreshDependencyHealth,
} = useSystemMonitor()

async function refreshDashboard() {
  dashboardLoading.value = true
  dashboardError.value = null
  try {
    const [nextSummary, nextConfig] = await Promise.all([
      api.get<DashboardSummary>('/dashboard/summary'),
      api.get<AppConfig>('/config'),
    ])
    summary.value = nextSummary
    config.value = nextConfig
  } catch (err) {
    dashboardError.value = err instanceof Error ? err.message : '加载首页失败'
  } finally {
    dashboardLoading.value = false
  }
}

async function fetchDashboard() {
  summary.value = await api.get<DashboardSummary>('/dashboard/summary')
}

async function toggleAutoSync() {
  if (!config.value || !summary.value) return
  autoSyncLoading.value = true
  try {
    const updated = await api.put<AppConfig>('/config', {
      ...config.value,
      sync: { ...config.value.sync, enabled: !summary.value.status.autoSyncEnabled },
    })
    config.value = updated
    await fetchDashboard()
    feedback.success(updated.sync.enabled ? '自动同步已开启' : '自动同步已关闭')
  } catch (err) {
    feedback.error('自动同步切换失败', err instanceof Error ? err.message : '请稍后重试')
  } finally {
    autoSyncLoading.value = false
  }
}

async function handleSync() {
  try {
    await triggerSync('normal')
    await fetchDashboard()
    feedback.success('同步已触发', '可在任务中心查看实时进度。')
  } catch (err) {
    feedback.error('同步触发失败', err instanceof Error ? err.message : '请稍后重试')
  }
}

let unsubSse: (() => void) | null = null
onMounted(async () => {
  startPolling(15000)
  await refreshDashboard()
  unsubSse = sseSubscribe('stage-change', async (data) => {
    if (data.stage === 'idle') await refreshDashboard()
  })
})
onUnmounted(() => {
  stopPolling()
  unsubSse?.()
})
</script>

<style scoped>
.dashboard-page { display: grid; gap: .85rem; }
.dashboard-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .75rem; }
.dashboard-toolbar__status, .dashboard-toolbar__actions, .dashboard-current-task { display: flex; align-items: center; }
.dashboard-toolbar__status { flex-wrap: wrap; gap: .8rem; min-width: 0; }
.dashboard-toolbar__status strong { color: var(--text-primary); font-size: .8rem; }
.dashboard-toolbar__timestamp { color: var(--text-muted); font-size: .76rem; white-space: nowrap; }
.dashboard-toolbar__actions { gap: .6rem; }
.dashboard-toggle { display: inline-flex; align-items: center; gap: .65rem; min-height: 2.4rem; padding: 0 .75rem; border: 1px solid var(--border-primary); border-radius: .8rem; background: var(--bg-input); color: var(--text-secondary); font-size: .76rem; white-space: nowrap; }
.dashboard-toggle--active { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, var(--border-primary)); }
.dashboard-toggle:disabled { opacity: .6; cursor: wait; }
.dashboard-toggle__track { position: relative; width: 2.1rem; height: 1.2rem; border-radius: 999px; background: color-mix(in srgb, var(--text-muted) 35%, transparent); }
.dashboard-toggle__thumb { position: absolute; top: .15rem; left: .15rem; width: .9rem; height: .9rem; border-radius: 999px; background: #fff; transition: transform 160ms ease; }
.dashboard-toggle__thumb--active { transform: translateX(.9rem); }
.dashboard-sync-button { min-width: 6.2rem; }
.dashboard-current-task { justify-content: space-between; gap: .8rem; padding: .8rem 1rem; color: inherit; text-decoration: none; border-color: color-mix(in srgb, var(--accent) 32%, var(--border-primary)); }
.dashboard-current-task__icon { display: inline-flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border-radius: 999px; color: var(--accent); background: var(--accent-muted); }
.dashboard-current-task div { flex: 1; min-width: 0; }
.dashboard-current-task strong { color: var(--text-primary); font-size: .82rem; }
.dashboard-current-task p { margin: .15rem 0 0; overflow: hidden; color: var(--text-muted); font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }
.dashboard-current-task > span:last-child { display: inline-flex; align-items: center; gap: .35rem; color: var(--accent); font-size: .75rem; white-space: nowrap; }
.dashboard-workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: .85rem; align-items: stretch; }
.dashboard-workspace > :deep(*) { min-height: 100%; }
.dashboard-monitor { display: grid; }
.dashboard-feedback { display: grid; place-items: center; min-height: 10rem; padding: 1rem; text-align: center; }
.dashboard-feedback--error { gap: .7rem; }
.dashboard-feedback p { margin: 0; color: var(--text-muted); }
@media (max-width: 900px) {
  .dashboard-toolbar, .dashboard-toolbar__actions { align-items: stretch; flex-direction: column; }
  .dashboard-toolbar__actions { width: 100%; }
  .dashboard-toggle, .dashboard-sync-button { width: 100%; justify-content: center; }
  .dashboard-workspace { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .dashboard-current-task { align-items: flex-start; flex-wrap: wrap; }
  .dashboard-current-task > span:last-child { width: 100%; padding-left: 2.8rem; }
}
</style>
