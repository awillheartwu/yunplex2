<template>
  <div class="page-stack system-workspace">
    <PageHeader title="系统状态" description="连接、资源与诊断，集中在一处。"><template #actions><NuxtLink to="/config" class="btn btn-secondary"><AppIcon name="settings" :size="15" />连接设置</NuxtLink></template></PageHeader>
    <PageTabs v-model="activeTab" class="system-view-tabs" :tabs="[{ key: 'health', label: '服务与资源' }, { key: 'logs', label: '运行日志' }]" aria-label="系统视图" />
    <template v-if="activeTab === 'health'">
      <SystemMonitorPanel :dependency-checked-label="dependencyCheckedLabel" :health-items="healthItems" :health-refreshing="healthRefreshing" :kpi-cards="kpiCards" :overall-tone="overallTone" @refresh-health="refreshDependencyHealth" @copy-diagnostics="copyDiagnostics" />
      <section class="system-trends" aria-labelledby="system-trends-title"><h2 id="system-trends-title">近期趋势</h2><DashboardCharts :download-trend="downloadTrend" :resource-trend="resourceTrend" /></section>
    </template>
    <SystemLogsPanel v-else />
  </div>
</template>
<script setup lang="ts">
import { useSystemMonitor } from '~/composables/useSystemMonitor'
import type { DashboardDownloadTrendPoint, DashboardSummary } from '~/types/dashboard'
const route = useRoute()
const router = useRouter()
const activeTab = ref(route.query.tab === 'logs' ? 'logs' : 'health')
const { copyDiagnostics, dependencyCheckedLabel, healthItems, healthRefreshing, kpiCards, overallTone, refreshDependencyHealth, resourceTrend } = useSystemMonitor()
const downloadTrend = ref<DashboardDownloadTrendPoint[]>([])
watch(activeTab, tab => router.replace({ query: tab === 'logs' ? { tab: 'logs' } : {} }))
watch(() => route.query.tab, tab => { activeTab.value = tab === 'logs' ? 'logs' : 'health' })
onMounted(async () => { try { downloadTrend.value = (await useApi().get<DashboardSummary>('/dashboard/summary')).downloadTrend } catch { /* Health remains available independently. */ } })
</script>

<style scoped>
.system-view-tabs { align-self: flex-start; max-width: 100%; }
.system-trends { display: flex; flex-direction: column; gap: var(--space-3); }
.system-trends > h2 { margin: 0; }
@media(max-width:720px) { .system-view-tabs { align-self: stretch; } }
</style>
