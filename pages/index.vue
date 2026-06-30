<template>
  <div class="dashboard-page">
    <section v-if="summary" class="dashboard-toolbar" aria-label="首页状态与同步操作">
      <div class="dashboard-topbar__main">
        <div class="dashboard-topbar__chips">
          <span
            v-for="item in summary.status.items"
            :key="item.key"
            class="dashboard-status-chip"
          >
            <span class="dashboard-status-chip__dot" :class="item.ok ? 'dashboard-status-chip__dot--ok' : 'dashboard-status-chip__dot--error'" />
            {{ item.label }}
          </span>
        </div>
        <span class="dashboard-topbar__timestamp">{{ formatDashboardLastSyncLabel(summary.status.lastSyncAt) }}</span>
      </div>

      <div class="dashboard-topbar__actions">
        <button
          class="dashboard-toggle"
          :class="summary.status.autoSyncEnabled ? 'dashboard-toggle--active' : ''"
          :disabled="autoSyncLoading"
          type="button"
          @click="toggleAutoSync"
        >
          <span class="dashboard-toggle__track">
            <span class="dashboard-toggle__thumb" :class="summary.status.autoSyncEnabled ? 'dashboard-toggle__thumb--active' : ''" />
          </span>
          <span>{{ autoSyncLoading ? '切换中...' : summary.status.autoSyncEnabled ? '自动同步已开启' : '自动同步已关闭' }}</span>
        </button>

        <button
          class="btn btn-primary dashboard-status-hero__sync"
          :disabled="syncState?.isRunning || syncLoading"
          type="button"
          @click="handleSync"
        >
          {{ syncState?.isRunning || syncLoading ? '同步中...' : '立即同步' }}
        </button>
      </div>
    </section>

    <div v-if="dashboardLoading" class="section-card dashboard-feedback">
      <p class="dashboard-feedback__title">加载中</p>
    </div>

    <div v-else-if="dashboardError" class="section-card dashboard-feedback dashboard-feedback--error">
      <p class="dashboard-feedback__title">首页数据暂时不可用</p>
      <p class="dashboard-feedback__copy">{{ dashboardError }}</p>
      <button class="btn btn-secondary btn-sm" type="button" @click="refreshDashboard">重新加载</button>
    </div>

    <template v-else-if="summary">
      <div class="dashboard-layout">
        <section class="section-card dashboard-trend-card dashboard-layout__trend">
          <div class="dashboard-trend-card__header">
            <h2 class="dashboard-section-title">近 7 天同步情况</h2>
          </div>
          <LazyDownloadChart :data="summary.trend.points" :days="summary.trend.days" />
        </section>

        <div class="dashboard-top-grid__kpis dashboard-layout__kpis">
          <DashboardKpiCard
            v-for="kpi in summary.kpis"
            :key="kpi.key"
            :kpi="kpi"
          />
        </div>

        <DashboardPendingList class="dashboard-layout__pending" :items="summary.pendingItems" />
        <DashboardActivityList class="dashboard-layout__activity" :items="summary.recentActivities" />
        <DashboardRecentPlexList class="dashboard-layout__recent" :items="recentPlexItems" />

        <DashboardSourceHealth class="dashboard-layout__health" :summary="summary.sourceHealth" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { AppConfig } from '~~/server/lib/config/types'
import type { DashboardSummary, PlexRecentItem } from '~~/types/dashboard'
import { formatDashboardLastSyncLabel } from '~~/composables/useDashboardFormat'
import { useFeedback } from '~~/composables/useFeedback'

const api = useApi()
const feedback = useFeedback()
const { state: syncState, loading: syncLoading, triggerSync, startPolling, stopPolling } = useSync()

const summary = ref<DashboardSummary | null>(null)
const recentPlexItems = ref<PlexRecentItem[]>([])
const dashboardLoading = ref(true)
const dashboardError = ref<string | null>(null)
const autoSyncLoading = ref(false)
const config = ref<AppConfig | null>(null)

async function loadConfig() {
  config.value = await api.get<AppConfig>('/config')
}

async function fetchDashboard() {
  summary.value = await api.get<DashboardSummary>('/dashboard/summary')
}

async function fetchRecentPlex() {
  try {
    recentPlexItems.value = await api.get<PlexRecentItem[]>('/plex/recently-added', { limit: '4' })
  } catch {
    recentPlexItems.value = []
  }
}

async function refreshDashboard() {
  dashboardLoading.value = true
  dashboardError.value = null
  try {
    await Promise.all([
      fetchDashboard(),
      fetchRecentPlex(),
      loadConfig(),
    ])
  } catch (err) {
    dashboardError.value = err instanceof Error ? err.message : '加载首页失败'
  } finally {
    dashboardLoading.value = false
  }
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
    await triggerSync(false)
    await fetchDashboard()
    feedback.success('同步已触发', '可在任务中心或动态页查看后续进度。')
  } catch (err) {
    feedback.error('同步触发失败', err instanceof Error ? err.message : '请稍后重试')
  }
}

let unsubSse: (() => void) | null = null

onMounted(async () => {
  startPolling(15000)
  await refreshDashboard()

  unsubSse = sseSubscribe('stage-change', async (data) => {
    if (data.stage === 'idle') {
      await refreshDashboard()
    }
  })
})

onUnmounted(() => {
  stopPolling()
  if (unsubSse) unsubSse()
})
</script>

<style scoped>
.dashboard-page {
  display: grid;
  gap: 0.95rem;
}

.dashboard-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  padding: 0 0.2rem;
}

.dashboard-topbar__main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.9rem;
  min-width: 0;
}

.dashboard-topbar__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.dashboard-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 1.75rem;
  padding: 0 0.62rem;
  border-radius: 999px;
  border: 1px solid var(--border-primary);
  background: var(--bg-input);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.dashboard-topbar__timestamp {
  font-size: 0.84rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.dashboard-status-chip__dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--text-tertiary);
}

.dashboard-status-chip__dot--ok {
  background: var(--success);
}

.dashboard-status-chip__dot--error {
  background: var(--danger);
}

.dashboard-topbar__actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.dashboard-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 2.1rem;
  padding: 0 0.78rem;
  border-radius: 0.9rem;
  border: 1px solid var(--border-primary);
  background: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
}

.dashboard-toggle--active {
  color: var(--accent);
  border-color: rgba(52, 87, 213, 0.24);
  background: var(--bg-surface);
}

.dashboard-toggle:disabled {
  opacity: 0.6;
  cursor: wait;
}

.dashboard-toggle__track {
  position: relative;
  width: 2.25rem;
  height: 1.3rem;
  border-radius: 999px;
  background: rgba(52, 87, 213, 0.28);
}

.dashboard-toggle__thumb {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  background: #fff;
  transition: transform 160ms ease;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
}

.dashboard-toggle__thumb--active {
  transform: translateX(0.95rem);
}

.dashboard-status-hero__sync {
  min-width: 6.4rem;
}

.dashboard-feedback {
  display: grid;
  place-items: center;
  min-height: 10rem;
  padding: 1rem;
  text-align: center;
}

.dashboard-feedback--error {
  justify-items: center;
  gap: 0.8rem;
}

.dashboard-feedback__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.dashboard-feedback__copy {
  margin: 0.4rem 0 0;
  max-width: 34rem;
  font-size: 0.82rem;
  line-height: 1.65;
  color: var(--text-tertiary);
}

.dashboard-top-grid__kpis {
  display: grid;
  gap: 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dashboard-layout {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  align-items: start;
}

.dashboard-layout__kpis {
  grid-column: 1 / span 4;
  grid-row: 1;
}

.dashboard-layout__trend {
  grid-column: 5 / span 8;
  grid-row: 1;
}

.dashboard-layout__pending,
.dashboard-layout__activity,
.dashboard-layout__recent {
  grid-column: span 4;
}

.dashboard-layout__health {
  grid-column: 1 / -1;
}

.dashboard-trend-card {
  display: grid;
  gap: 0.35rem;
  padding: 0.9rem 1rem;
  min-height: 12.6rem;
}

@media (max-width: 1279px) {
  .dashboard-layout {
    grid-template-columns: 1fr;
  }

  .dashboard-layout__kpis,
  .dashboard-layout__trend,
  .dashboard-layout__pending,
  .dashboard-layout__activity,
  .dashboard-layout__recent,
  .dashboard-layout__health {
    grid-column: auto;
    grid-row: auto;
  }
}

@media (max-width: 767px) {
  .dashboard-toolbar,
  .dashboard-topbar__actions {
    display: grid;
  }

  .dashboard-status-hero__sync,
  .dashboard-toggle {
    width: 100%;
    justify-content: center;
  }

  .dashboard-topbar__actions {
    width: 100%;
    grid-template-columns: 1fr;
  }

  .dashboard-topbar__main {
    align-items: flex-start;
  }

  .dashboard-topbar__timestamp {
    white-space: normal;
  }

  .dashboard-top-grid__kpis {
    grid-template-columns: 1fr;
  }
}
</style>
