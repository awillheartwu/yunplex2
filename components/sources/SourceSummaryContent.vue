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
