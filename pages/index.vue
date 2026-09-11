<template>
  <div class="home-workspace">
    <PageHeader title="工作台" description="从喜欢的歌单，到属于自己的音乐库。"><template #actions><NuxtLink to="/manual-download" class="btn btn-primary"><AppIcon name="plus" :size="16" />添加音乐</NuxtLink></template></PageHeader>
    <div v-if="dashboardError" class="home-error" role="alert"><div><strong>工作台暂时无法更新</strong><p>{{ dashboardError }}</p></div><button class="btn btn-secondary" @click="refreshDashboard">重新加载</button></div>
    <div v-if="dashboardLoading && !summary" class="home-loading" role="status">正在整理你的音乐工作台…</div>
    <template v-if="summary">
      <div class="home-pulse"><span><strong>{{ sources.length }}</strong> 个音乐收藏</span><span><strong>{{ sources.filter(item => item.type === 'playlist' && item.enabled).length }}</strong> 个自动管理</span><span><strong>{{ weeklyDownloads }}</strong> 首本周下载</span><NuxtLink to="/system"><span class="home-pulse__dot" />系统状态<AppIcon name="arrowRight" :size="13" /></NuxtLink></div>
      <SourceRequestResults :results="sourceRequestResults" @dismiss="sourceRequestResults = []" />
      <div class="home-columns">
        <div class="home-main">
          <section class="home-shelf" aria-label="最近的音乐收藏">
            <header class="workspace-section-heading"><div><h2>最近的音乐收藏</h2><p>继续管理你的歌单和专辑。</p></div><NuxtLink to="/sync-sources">打开音乐库<AppIcon name="arrowRight" :size="14" /></NuxtLink></header>
            <div v-if="recentSources.length" class="home-collections"><NuxtLink v-for="(source, index) in recentSources" :key="source.id" :to="`/sync-sources/${source.id}`" class="home-collection" :data-tint="index % 3"><div class="home-collection__cover"><img v-if="source.coverUrl && !brokenCovers.has(source.id)" :src="getSyncSourceCoverUrl(source.coverUrl)" alt="" @error="brokenCovers.add(source.id)"><AppIcon v-else :name="source.type === 'album' ? 'album' : 'music'" :size="36" /><span>{{ source.type === 'album' ? '专辑' : '歌单' }}</span></div><strong>{{ source.name || source.neteasePlaylistName }}</strong><small>{{ source.trackCount }} 首 · {{ source.lastSyncedAt ? formatSyncSourceRelativeTime(source.lastSyncedAt) : '尚未同步' }}</small></NuxtLink></div>
            <div v-else class="home-start"><span class="home-start__icon"><AppIcon name="music" :size="40" /></span><h3>为你的音乐留一个位置。</h3><p>添加网易云歌单或专辑，更新、下载和 Plex 同步会在这里汇合。</p><NuxtLink to="/sync-sources?add=1" class="btn btn-primary"><AppIcon name="plus" :size="16" />收藏第一张歌单</NuxtLink><NuxtLink to="/config" class="home-start__help">先连接网易云与 Plex<AppIcon name="arrowRight" :size="13" /></NuxtLink></div>
          </section>
          <section class="home-attention" aria-label="需要你处理"><header class="workspace-section-heading"><div><h2>需要你处理 <span>{{ pendingTotal }}</span></h2><p>需要确认和未解决的问题，集中处理。</p></div><NuxtLink to="/task-center?tab=failures">全部事项<AppIcon name="arrowRight" :size="14" /></NuxtLink></header><div v-if="summary.pendingItems.length" class="home-inbox"><NuxtLink v-for="item in summary.pendingItems" :key="item.id" :to="item.link"><span class="home-inbox__icon" :class="`text-${item.tone === 'danger' ? 'danger' : 'warning'}`"><AppIcon :name="item.icon" :size="19" /></span><div><strong>{{ item.title }}</strong><p>{{ item.subtitle }}</p></div><span class="home-inbox__count">{{ item.count }}</span><AppIcon name="chevronRight" :size="15" /></NuxtLink></div><div v-else class="home-inbox-clear"><AppIcon name="checkCircle" :size="22" /><div><strong>暂时没有需要处理的事项</strong><p>新的确认和异常会出现在这里。</p></div></div></section>
        </div>
        <aside class="home-rail">
          <section class="home-sync" aria-label="同步控制"><div class="home-sync__icon"><AppIcon :name="syncState?.isRunning ? 'sync' : 'checkCircle'" :size="23" :class="{ 'animate-spin': syncState?.isRunning }" /></div><p class="home-label">SYNC STATUS</p><h2>{{ syncState?.isRunning ? '正在同步音乐' : '准备好下一次更新' }}</h2><p class="home-sync__copy">{{ syncState?.isRunning ? syncState.currentSong || syncState.currentSourceName || '正在准备同步' : formatDashboardLastSyncLabel(summary.status.lastSyncAt) }}</p><button class="btn btn-primary" :disabled="syncState?.isRunning || syncLoading" @click="handleSync">{{ syncState?.isRunning ? '同步中…' : syncLoading ? '提交中…' : '立即同步' }}<AppIcon name="arrowRight" :size="15" /></button><NuxtLink v-if="syncState?.isRunning" to="/task-center" class="home-sync__activity">查看实时活动<AppIcon name="arrowRight" :size="13" /></NuxtLink><div class="home-auto"><div><strong>自动更新</strong><small>{{ summary.status.autoSyncEnabled ? `全局间隔 ${config?.sync.intervalMinutes || 30} 分钟` : '由你决定何时同步' }}</small></div><button role="switch" :aria-checked="summary.status.autoSyncEnabled" aria-label="自动同步" :disabled="autoSyncLoading" class="home-auto__switch" @click="toggleAutoSync"><span /></button></div></section>
          <section class="home-library-status"><p class="home-label">COLLECTION HEALTH</p><h2>收藏状态</h2><div v-for="item in healthBreakdown" :key="item.label"><span><i :class="`bg-${item.tone}`" />{{ item.label }}</span><strong>{{ item.count }}</strong></div><NuxtLink to="/sync-sources">管理全部收藏<AppIcon name="arrowRight" :size="13" /></NuxtLink></section>
        </aside>
      </div>
    </template>
  </div>
</template>
<script setup lang="ts">
import { useFeedback } from '~/composables/useFeedback'
import type { AppConfig } from '~~/server/lib/config/types'
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import type { SourceRequestResult } from '~~/server/lib/sync/source-requests'
import type { DashboardSummary } from '~/types/dashboard'
import { formatDashboardLastSyncLabel } from '~/composables/useDashboardFormat'
import { formatSyncSourceRelativeTime, getSyncSourceCoverUrl } from '~/composables/useSyncSourcePresentation'
const api = useApi(), feedback = useFeedback()
const { state: syncState, loading: syncLoading, triggerSync, startPolling, stopPolling } = useSync()
const sourceRequestResults = ref<SourceRequestResult[]>([]), sources = ref<PlaylistSource[]>([])
const summary = ref<DashboardSummary | null>(null), config = ref<AppConfig | null>(null)
const dashboardLoading = ref(true), dashboardError = ref<string | null>(null), autoSyncLoading = ref(false)
const brokenCovers = reactive(new Set<string>())
const recentSources = computed(() => [...sources.value].sort((a,b) => (b.lastSyncedAt || b.updatedAt).localeCompare(a.lastSyncedAt || a.updatedAt)).slice(0,6))
const weeklyDownloads = computed(() => summary.value?.downloadTrend.reduce((total, day) => total + day.count, 0) || 0)
const pendingTotal = computed(() => summary.value?.pendingItems.reduce((total, item) => total + item.count, 0) || 0)
const healthBreakdown = computed(() => [{ label: '已同步', tone: 'success', count: summary.value?.sourceHealth.normal || 0 },{ label: '待首次同步', tone: 'existing', count: summary.value?.sourceHealth.unsynced || 0 },{ label: '需要关注', tone: 'warning', count: (summary.value?.sourceHealth.warning || 0) + (summary.value?.sourceHealth.failed || 0) }])
async function refreshDashboard() {
  dashboardLoading.value = true; dashboardError.value = null
  try {
    const [data, settings, items] = await Promise.all([api.get<DashboardSummary>('/dashboard/summary'), api.get<AppConfig>('/config'), api.get<PlaylistSource[]>('/playlist-sources')])
    summary.value = data; config.value = settings; sources.value = items
  } catch (err) { dashboardError.value = err instanceof Error ? err.message : '加载失败，请重试' }
  finally { dashboardLoading.value = false }
}
async function toggleAutoSync() {
  if (!config.value || !summary.value) return
  autoSyncLoading.value = true
  try { config.value = await api.put<AppConfig>('/config', { sync: { enabled: !summary.value.status.autoSyncEnabled } }); summary.value = await api.get<DashboardSummary>('/dashboard/summary'); feedback.success(config.value.sync.enabled ? '自动同步已开启' : '自动同步已关闭') }
  catch (err) { feedback.error('自动同步切换失败', err instanceof Error ? err.message : '请稍后重试') }
  finally { autoSyncLoading.value = false }
}
async function handleSync() {
  sourceRequestResults.value = []
  try { const result = await triggerSync('normal'); sourceRequestResults.value = result.results; await refreshDashboard(); const accepted = result.results.filter(item => item.status === 'accepted').length; const waiting = result.results.filter(item => item.status === 'awaiting_review').length; feedback.success(`已接受 ${accepted} 个来源请求，${waiting} 个来源等待确认`, '可在来源详情或活动中查看进度。') }
  catch (err) { feedback.error('同步触发失败', err instanceof Error ? err.message : '请稍后重试') }
}
let unsubscribe: (() => void) | null = null
onMounted(() => { startPolling(15000); void refreshDashboard(); unsubscribe = sseSubscribe('stage-change', data => { if(data.stage === 'idle') void refreshDashboard() }) })
onUnmounted(() => { stopPolling(); unsubscribe?.() })
</script>
<style scoped src="~/assets/css/pages/home-workspace.css"></style>
