<template>
  <section class="section-card dashboard-panel">
    <div class="dashboard-panel__header">
      <h2 class="dashboard-section-title">{{ title }}</h2>
    </div>

    <ProcessTimeline
      v-if="timelineItems.length > 0"
      :items="timelineItems"
      compact
      aria-label="仪表盘最近活动"
    />
    <div v-else class="dashboard-empty">
      <p class="dashboard-empty__title">暂无活动</p>
    </div>

    <div class="dashboard-panel__footer">
      <NuxtLink :to="footerLink" class="dashboard-footer-link">
        查看全部活动
        <AppIcon name="arrowRight" :size="14" />
      </NuxtLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DashboardActivityItem } from '~~/types/dashboard'
import { DASHBOARD_ACTIVITY_PREVIEW_ROUTE } from '~~/lib/activity-presentation'
import { dashboardActivityItemToTimelineItem } from '~~/lib/activity-timeline'

const props = withDefaults(defineProps<{
  items: DashboardActivityItem[]
  title?: string
  footerLink?: string
}>(), {
  title: '最近活动',
  footerLink: DASHBOARD_ACTIVITY_PREVIEW_ROUTE,
})

const timelineItems = computed(() => props.items.map(dashboardActivityItemToTimelineItem))
</script>

<style scoped>
.dashboard-panel {
  display: grid;
  gap: 0.55rem;
  padding: 0.9rem 1rem 0.8rem;
  min-height: 100%;
}

.dashboard-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.dashboard-empty {
  display: flex;
  align-items: center;
  min-height: 10rem;
  padding: 0.25rem 0;
}

.dashboard-empty__title {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-tertiary);
}

.dashboard-panel__footer {
  display: flex;
  justify-content: center;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-primary);
}
</style>
