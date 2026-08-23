<template>
  <section class="section-card dashboard-panel">
    <div class="dashboard-panel__header">
      <h2 class="dashboard-section-title">最近添加到 Plex</h2>
    </div>

    <NuxtLink :to="historyLink" class="dashboard-panel__content-link" aria-label="查看运行记录">
      <div v-if="items.length > 0" class="dashboard-plex-list">
        <div
          v-for="item in items"
          :key="item.ratingKey"
          class="dashboard-plex-row"
        >
          <div class="dashboard-plex-row__cover">
            <img v-if="item.thumb" :src="item.thumb" :alt="item.title" loading="lazy">
            <div v-else class="dashboard-plex-row__cover-fallback">
              <AppIcon name="album" :size="16" />
            </div>
          </div>
          <div class="dashboard-plex-row__body">
            <p class="dashboard-plex-row__title">{{ item.title }}</p>
            <p class="dashboard-plex-row__subtitle">
              {{ item.artist }}<span v-if="item.album"> · {{ item.album }}</span>
            </p>
          </div>
          <div class="dashboard-plex-row__meta">
            <p class="dashboard-plex-row__time">{{ item.addedAt ? formatDashboardRelativeTime(item.addedAt) : '刚刚' }}</p>
          </div>
        </div>
      </div>
      <div v-else class="dashboard-empty">
        <p class="dashboard-empty__title">暂无入库记录</p>
      </div>

      <div class="dashboard-panel__footer">
        <span class="dashboard-footer-link">
        查看全部
        <AppIcon name="arrowRight" :size="14" />
        </span>
      </div>
    </NuxtLink>
  </section>
</template>

<script setup lang="ts">
import type { PlexRecentItem } from '~~/types/dashboard'
import { formatDashboardRelativeTime } from '~~/composables/useDashboardFormat'

defineProps<{
  items: PlexRecentItem[]
}>()

const historyLink = '/system?tab=runs'
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

.dashboard-panel__content-link {
  display: grid;
  gap: 0.55rem;
  color: inherit;
  text-decoration: none;
}

.dashboard-plex-list {
  display: grid;
  gap: 0.15rem;
}

.dashboard-plex-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.68rem;
  align-items: center;
  padding: 0.48rem 0.1rem;
  border-bottom: 1px solid var(--border-primary);
  transition: transform 160ms ease, opacity 160ms ease;
}

.dashboard-panel__content-link:hover .dashboard-plex-row {
  opacity: 0.96;
}

.dashboard-panel__content-link:hover .dashboard-panel__footer :deep(.app-icon) {
  transform: translateX(2px);
}

.dashboard-plex-row:last-child {
  border-bottom: 0;
}

.dashboard-plex-row__cover,
.dashboard-plex-row__cover img,
.dashboard-plex-row__cover-fallback {
  width: 2.15rem;
  height: 2.15rem;
  border-radius: 0.55rem;
}

.dashboard-plex-row__cover {
  overflow: hidden;
  background: var(--bg-input);
  border: 1px solid var(--border-primary);
}

.dashboard-plex-row__cover img {
  display: block;
  object-fit: cover;
}

.dashboard-plex-row__cover-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.dashboard-plex-row__body {
  min-width: 0;
}

.dashboard-plex-row__title {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.3;
}

.dashboard-plex-row__subtitle {
  margin: 0.18rem 0 0;
  font-size: 0.74rem;
  color: var(--text-tertiary);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dashboard-plex-row__meta {
  display: flex;
  align-items: center;
  justify-items: end;
}

.dashboard-plex-row__time {
  margin: 0;
  font-size: 0.72rem;
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
