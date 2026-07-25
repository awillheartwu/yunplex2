<template>
  <main class="match-management-page space-y-5">
    <PageHeader
      title="匹配管理"
      description="查看每个歌单的目标身份、Plex 实际对齐状态与不可变决策历史。弱证据候选仍受删除保护。"
    >
      <template #actions>
        <button class="btn btn-secondary btn-sm" :disabled="refreshing" @click="refreshActive">
          <AppIcon :name="refreshing ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': refreshing }" />
          {{ refreshing ? '刷新中' : '刷新当前视图' }}
        </button>
      </template>
    </PageHeader>

    <nav class="management-tabs" aria-label="匹配管理视图">
      <button
        v-for="item in tabs"
        :key="item.id"
        class="management-tab"
        :class="{ 'management-tab--active': tab === item.id }"
        :aria-current="tab === item.id ? 'page' : undefined"
        @click="setTab(item.id)"
      >
        <AppIcon :name="item.icon" :size="15" />
        <span>{{ item.label }}</span>
        <small>{{ item.description }}</small>
      </button>
    </nav>

    <KeepAlive :max="3">
      <ReviewQueueTab v-if="tab === 'reviews'" :key="`reviews:${refreshKey}`" />
      <OverviewTab
        v-else-if="tab === 'overview'"
        :key="`overview:${refreshKey}`"
        :initial-source-id="sourceId"
        @source-change="setSource"
      />
      <IdentityHistoryTab
        v-else
        :key="`history:${refreshKey}`"
        :initial-source-id="sourceId"
        @source-change="setSource"
      />
    </KeepAlive>
  </main>
</template>

<script setup lang="ts">
import {
  type MatchManagementTab,
  useMatchManagementRouteState,
} from '~/composables/useMatchManagementRouteState'

const tabs: Array<{ id: MatchManagementTab; label: string; description: string; icon: string }> = [
  { id: 'reviews', label: '待审核', description: '处理证据不足的候选', icon: 'shield' },
  { id: 'overview', label: '匹配总览', description: '按歌单检查全部目标', icon: 'list' },
  { id: 'history', label: '决策历史', description: '追溯身份变化', icon: 'logs' },
]
const { tab, sourceId, setTab, setSource } = useMatchManagementRouteState()
const refreshKey = ref(0)
const refreshing = ref(false)

async function refreshActive() {
  refreshing.value = true
  refreshKey.value++
  await nextTick()
  refreshing.value = false
}
</script>

<style scoped>
.match-management-page { max-width: 1440px; margin: 0 auto; }
.management-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: .65rem;
  padding: .45rem;
  border: 1px solid var(--border-primary);
  border-radius: .8rem;
  background: var(--bg-surface);
}
.management-tab {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: .1rem .55rem;
  min-height: 3.7rem;
  padding: .65rem .8rem;
  border: 1px solid transparent;
  border-radius: .62rem;
  color: var(--text-muted);
  text-align: left;
  transition: 150ms ease;
}
.management-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
.management-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.management-tab--active {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border-primary));
  background: color-mix(in srgb, var(--accent-muted) 55%, var(--bg-surface));
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.management-tab span { font-size: .82rem; font-weight: 700; }
.management-tab small { grid-column: 2; font-size: .66rem; color: var(--text-muted-deep); }
@media (max-width: 680px) {
  .management-tabs { grid-template-columns: 1fr; }
  .management-tab { min-height: 3.2rem; }
}
@media (prefers-reduced-motion: reduce) {
  .management-tab { transition: none; }
}
</style>
