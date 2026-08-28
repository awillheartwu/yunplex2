<template>
  <section class="section-card dashboard-health">
    <div class="dashboard-health__header">
      <h2 class="dashboard-section-title">同步源健康度</h2>
      <NuxtLink to="/sync-sources" class="dashboard-health__link">
        查看同步源管理
        <AppIcon name="arrowRight" :size="14" />
      </NuxtLink>
    </div>

    <div class="dashboard-health__body">
      <div class="dashboard-health__summary">
        <span class="dashboard-health__label">总数</span>
        <span class="dashboard-health__value">{{ summary.total }}</span>
      </div>

      <div class="dashboard-health__main">
        <div class="dashboard-health__bar">
          <div class="dashboard-health__segment dashboard-health__segment--success" :style="{ width: getDashboardSourceHealthWidth(summary.normal, summary.total) }" />
          <div class="dashboard-health__segment dashboard-health__segment--warning" :style="{ width: getDashboardSourceHealthWidth(summary.warning, summary.total) }" />
          <div class="dashboard-health__segment dashboard-health__segment--danger" :style="{ width: getDashboardSourceHealthWidth(summary.failed, summary.total) }" />
          <div class="dashboard-health__segment dashboard-health__segment--neutral" :style="{ width: getDashboardSourceHealthWidth(summary.unsynced, summary.total) }" />
        </div>

        <div class="dashboard-health__legend">
          <div
            v-for="item in legendItems"
            :key="item.key"
            class="dashboard-health__legend-item"
          >
            <span class="dashboard-health__dot" :class="`dashboard-health__dot--${item.tone}`" />
            <span>{{ item.label }} {{ item.value }} ({{ item.percent }})</span>
          </div>
          <div v-if="summary.total === 0" class="dashboard-health__legend-item">
            <span class="dashboard-health__dot dashboard-health__dot--neutral" />
            <span>当前没有同步源数据</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DashboardSourceHealthSummary } from '~~/types/dashboard'
import { getDashboardSourceHealthLegend, getDashboardSourceHealthWidth } from './source-health'

const props = defineProps<{
  summary: DashboardSourceHealthSummary
}>()

const legendItems = computed(() => getDashboardSourceHealthLegend(props.summary))
</script>

<style scoped>
.dashboard-health {
  display: grid;
  gap: 1.35rem;
  padding: 1.25rem 1rem;
}

.dashboard-health__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.dashboard-health__link {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 650;
}

.dashboard-health__body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1.25rem;
  align-items: center;
}

.dashboard-health__summary {
  display: grid;
  gap: 0.3rem;
  min-width: 4rem;
}

.dashboard-health__label {
  font-size: 0.76rem;
  color: var(--text-tertiary);
}

.dashboard-health__value {
  font-size: 2.05rem;
  line-height: 1;
  font-weight: 700;
  color: var(--text-primary);
}

.dashboard-health__main {
  display: grid;
  gap: 0.95rem;
}

.dashboard-health__bar {
  display: flex;
  min-height: 0.9rem;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(125, 137, 160, 0.18);
}

.dashboard-health__segment--success { background: var(--success); }
.dashboard-health__segment--warning { background: var(--warning); }
.dashboard-health__segment--danger { background: var(--danger); }
.dashboard-health__segment--neutral { background: rgba(156, 163, 175, 0.6); }

.dashboard-health__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem 1.5rem;
}

.dashboard-health__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.dashboard-health__dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
}

.dashboard-health__dot--success { background: var(--success); }
.dashboard-health__dot--warning { background: var(--warning); }
.dashboard-health__dot--danger { background: var(--danger); }
.dashboard-health__dot--neutral { background: rgba(156, 163, 175, 0.8); }

@media (max-width: 767px) {
  .dashboard-health__header,
  .dashboard-health__body {
    grid-template-columns: 1fr;
    display: grid;
  }

  .dashboard-health__header {
    gap: 0.8rem;
  }
}
</style>
