<template>
  <section class="section-card dashboard-panel">
    <div class="dashboard-panel__header">
      <h2 class="dashboard-section-title">待处理事项</h2>
    </div>

    <div v-if="items.length > 0" class="dashboard-list">
      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="item.link"
        class="dashboard-list__row"
      >
        <div class="dashboard-list__icon" :class="`dashboard-list__icon--${item.tone}`">
          <AppIcon :name="item.icon" :size="16" />
        </div>
        <div class="dashboard-list__body">
          <p class="dashboard-list__title">{{ item.title }}</p>
          <p class="dashboard-list__subtitle">{{ item.subtitle }}</p>
        </div>
        <div class="dashboard-list__meta">
          <span class="dashboard-list__count" :class="`dashboard-list__count--${item.tone}`">{{ item.count }}</span>
          <AppIcon name="chevronRight" :size="16" class="dashboard-list__chevron" />
        </div>
      </NuxtLink>
    </div>
    <div v-else class="dashboard-empty">
      <p class="dashboard-empty__title">暂无待处理事项</p>
    </div>

    <div class="dashboard-panel__footer">
      <NuxtLink to="/task-center?tab=failures" class="dashboard-footer-link">
        查看全部待处理
        <AppIcon name="arrowRight" :size="14" />
      </NuxtLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DashboardPendingItem } from '~~/types/dashboard'
defineProps<{
  items: DashboardPendingItem[]
}>()
</script>

<style scoped>
.dashboard-panel {
  display: grid;
  gap: 0.55rem;
  padding: 0.9rem 1rem 0.8rem;
}

.dashboard-panel__header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.dashboard-list {
  display: grid;
  gap: 0.45rem;
}

.dashboard-list__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.8rem;
  padding: 0.65rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--border-primary);
  background: var(--bg-input);
  color: inherit;
  text-decoration: none;
  transition: border-color 160ms ease, background 160ms ease;
}

.dashboard-list__row:hover {
  border-color: var(--border-secondary);
  background: var(--bg-surface);
}

.dashboard-list__body {
  min-width: 0;
}

.dashboard-list__icon {
  display: inline-flex;
  width: 1.8rem;
  height: 1.8rem;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--border-primary);
  background: var(--bg-input);
}

.dashboard-list__icon--accent { color: var(--accent); background: var(--accent-muted); }
.dashboard-list__icon--warning { color: var(--warning); background: var(--warning-soft); }
.dashboard-list__icon--danger { color: var(--danger); background: var(--danger-soft); }

.dashboard-list__title {
  margin: 0;
  font-size: 0.84rem;
  color: var(--text-primary);
  font-weight: 600;
}

.dashboard-list__subtitle {
  margin: 0.22rem 0 0;
  font-size: 0.76rem;
  color: var(--text-tertiary);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dashboard-list__meta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-width: 2rem;
}

.dashboard-list__count,
.dashboard-list__count--accent { color: var(--accent); }
.dashboard-list__count--warning { color: var(--warning); }
.dashboard-list__count--danger { color: var(--danger); }

.dashboard-list__count {
  font-size: 0.96rem;
  font-weight: 700;
}

.dashboard-list__chevron {
  color: var(--text-tertiary);
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
  padding-top: 0.45rem;
  border-top: 1px solid var(--border-primary);
}
</style>
