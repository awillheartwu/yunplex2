<template>
  <div class="sync-hover-card__header">
    <div class="sync-hover-card__cover">
      <img v-if="source.coverUrl" :src="coverSrc" :alt="`${displayName} 封面`">
      <div v-else class="sync-hover-card__cover-fallback">
        <AppIcon :name="source.type === 'album' ? 'album' : 'music'" :size="22" />
      </div>
    </div>
    <div class="min-w-0">
      <div class="sync-hover-card__title-row">
        <span class="sync-hover-card__title">{{ displayName }}</span>
        <SourceBadge :type="source.type" :subscribed="source.subscribed" />
      </div>
      <p v-if="originName !== displayName" class="sync-hover-card__origin">{{ originName }}</p>
      <p class="sync-hover-card__meta">ID {{ source.neteasePlaylistId }} · Plex {{ plexTargetName }}</p>
    </div>
    <slot name="header-action" />
  </div>
  <div class="sync-hover-card__stats">
    <span>{{ source.trackCount }} 首</span>
    <span>{{ issueSummary }}</span>
    <span>{{ repairing ? '修复中' : resultLabel }}</span>
  </div>
  <p class="sync-hover-card__footer">{{ lastActivity }}</p>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import {
  formatSyncSourceRelativeTime,
  getIssueSummaryLabel,
  getPlexTargetName,
  getSourceDisplayName,
  getSourceOriginName,
  getSyncResultLabel,
  getSyncSourceCoverUrl,
} from '~~/composables/useSyncSourcePresentation'

const props = defineProps<{
  source: PlaylistSource
  repairing: boolean
}>()

const displayName = computed(() => getSourceDisplayName(props.source))
const originName = computed(() => getSourceOriginName(props.source))
const plexTargetName = computed(() => getPlexTargetName(props.source))
const issueSummary = computed(() => getIssueSummaryLabel(props.source))
const resultLabel = computed(() => getSyncResultLabel(props.source))
const coverSrc = computed(() => getSyncSourceCoverUrl(props.source.coverUrl))
const lastActivity = computed(() => props.source.lastSyncedAt
  ? `${props.source.type === 'album' ? '上次下载' : '上次同步'} ${formatSyncSourceRelativeTime(props.source.lastSyncedAt)}`
  : props.source.type === 'album' ? '尚未下载' : '尚未同步')
</script>

<style scoped>
.sync-hover-card__header {
  display: flex;
  gap: var(--space-3_5);
  min-width: 0;
}

.sync-hover-card__cover,
.sync-hover-card__cover img,
.sync-hover-card__cover-fallback {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: var(--radius-xl);
  flex-shrink: 0;
}

.sync-hover-card__cover {
  overflow: hidden;
  background: var(--bg-input);
}

.sync-hover-card__cover img {
  display: block;
  object-fit: cover;
}

.sync-hover-card__cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  background: var(--bg-input);
}

.sync-hover-card__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.sync-hover-card__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.sync-hover-card__origin,
.sync-hover-card__meta,
.sync-hover-card__footer {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  line-height: 1.45;
  color: var(--text-tertiary);
}

.sync-hover-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-3_5);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
