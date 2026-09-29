<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import {
  getSyncResultLabel,
  getIssueCount,
  getIssueSummaryLabel,
  formatSyncSourceRelativeTime,
} from '~/composables/useSyncSourcePresentation'
defineProps<{ source: PlaylistSource }>()
const emit = defineEmits<{ runs: [] }>()
</script>

<template>
  <section class="section-card source-detail__status" aria-label="收藏同步状态">
    <div class="source-detail__status-main">
      <AppIcon
        :name="source.lastStatus === 'failed' ? 'warn' : source.lastStatus === 'success' ? 'checkCircle' : 'sync'"
        :size="24"
      />
      <div>
        <span>最近结果</span>
        <h2>{{ getSyncResultLabel(source) }}</h2>
        <p>
          {{
            source.lastSyncedAt
              ? `上次同步 ${formatSyncSourceRelativeTime(source.lastSyncedAt)}`
              : '同步后可在这里查看结果'
          }}
        </p>
      </div>
      <button class="btn btn-secondary btn-sm" aria-label="查看运行记录" title="查看此收藏的接管、同步与修复记录" @click="emit('runs')">
        <AppIcon name="activity" :size="14" />运行记录
      </button>
    </div>
    <div class="source-detail__attention" :class="{ 'source-detail__attention--warning': getIssueCount(source) > 0 }">
      <AppIcon :name="getIssueCount(source) > 0 ? 'warn' : 'check'" :size="16" /><span>{{
        getIssueSummaryLabel(source)
      }}</span
      ><NuxtLink
        v-if="getIssueCount(source) > 0"
        :to="`/task-center?tab=failures&failureSource=${source.id}`"
        class="btn btn-ghost btn-sm"
        >处理异常<AppIcon name="arrowRight" :size="14"
      /></NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.source-detail__status {
  padding: var(--space-5);
}
.source-detail__status-main {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.source-detail__status-main > svg {
  color: var(--accent);
}
.source-detail__status-main > div {
  flex: 1;
  min-width: 0;
}
.source-detail__status-main span,
.source-detail__status-main p {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.source-detail__status-main h2 {
  margin: var(--space-1) 0;
}
.source-detail__attention {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-primary);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.source-detail__attention--warning {
  color: var(--warning);
}
.source-detail__attention > span {
  flex: 1;
}
@media (max-width: 560px) {
  .source-detail__status-main {
    flex-wrap: wrap;
  }
  .source-detail__status-main > .btn {
    margin-left: var(--space-10);
  }
}
</style>
