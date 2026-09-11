<template>
  <div class="library-collection" :class="`library-collection--${view}`" aria-label="音乐收藏">
    <article v-for="(source, index) in sources" :key="source.id" class="collection-item" :class="{ 'is-selected': selected.has(source.id), 'is-drag-over': dragOver === index }" :data-tint="index % 4" :draggable="reorder" @dragstart="reorder && $emit('drag-start', index, $event)" @dragover.prevent="reorder && $emit('drag-over', index)" @dragleave="reorder && $emit('drag-leave')" @drop.prevent="reorder && $emit('drop', index)" @dragend="reorder && $emit('drag-end')">
      <div class="collection-item__art">
        <NuxtLink :to="`/sync-sources/${source.id}`" :aria-label="`打开 ${getSourceDisplayName(source)}`" :draggable="false" tabindex="-1">
          <img v-if="source.coverUrl && !broken.has(source.id)" :src="getSyncSourceCoverUrl(source.coverUrl)" alt="" :draggable="false" loading="lazy" @error="broken.add(source.id)">
          <div v-else class="collection-item__placeholder"><AppIcon :name="source.type === 'album' ? 'album' : 'music'" :size="40" /><span>{{ source.type === 'album' ? 'ALBUM' : 'PLAYLIST' }}</span></div>
        </NuxtLink>
        <label class="collection-item__select" :class="{ 'is-visible': selected.size > 0 }"><input type="checkbox" :checked="selected.has(source.id)" :aria-label="`选择 ${getSourceDisplayName(source)}`" @change="$emit('select', source.id)"></label>
        <span v-if="reorder" class="collection-item__grip" title="拖动调整顺序"><AppIcon name="grip" :size="18" /></span>
        <span class="collection-item__kind">{{ source.type === 'album' ? '专辑' : '歌单' }}</span>
      </div>
      <div class="collection-item__body">
        <NuxtLink :to="`/sync-sources/${source.id}`" class="collection-item__title">{{ getSourceDisplayName(source) }}</NuxtLink>
        <p class="collection-item__meta">{{ source.trackCount || 0 }} 首音乐<span>·</span>{{ source.type === 'album' ? '本地收藏' : source.enabled ? '自动管理' : '已暂停' }}</p>
        <p class="collection-item__target" :title="getPlexTargetName(source)"><AppIcon name="link" :size="12" />{{ getPlexTargetName(source) }}</p>
      </div>
      <div class="collection-item__status"><span :class="`text-${getSyncResultTone(source) === 'danger' ? 'danger' : getSyncResultTone(source) === 'success' ? 'success' : 'muted'}`">{{ getSyncResultLabel(source) }}</span><small>{{ source.lastSyncedAt ? formatSyncSourceRelativeTime(source.lastSyncedAt) : '等待首次同步' }}</small></div>
      <div class="collection-item__actions">
        <NuxtLink v-if="getActionableFailureCount(source)" :to="`/task-center?tab=failures&failureSource=${source.id}`" class="collection-item__issue"><AppIcon name="warn" :size="13" />{{ getActionableFailureCount(source) }} 个问题</NuxtLink>
        <button v-if="source.type === 'playlist'" class="icon-button" :aria-label="source.enabled ? '暂停此来源' : '启用此来源'" :disabled="toggling === source.id" @click="$emit('toggle', source)"><AppIcon :name="source.enabled ? 'pause' : 'play'" :size="15" /></button>
        <button class="btn btn-secondary btn-sm" :disabled="busy || (source.type === 'playlist' && !source.enabled)" @click="$emit('sync', source)"><AppIcon :name="syncing === source.id ? 'loader' : source.type === 'album' ? 'download' : 'sync'" :size="14" :class="{ 'animate-spin': syncing === source.id }" />{{ source.type === 'album' ? '下载' : '同步' }}</button>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import { getSourceDisplayName, getPlexTargetName, getSyncSourceCoverUrl, getActionableFailureCount, getSyncResultLabel, getSyncResultTone, formatSyncSourceRelativeTime } from '~/composables/useSyncSourcePresentation'
defineProps<{ sources: PlaylistSource[]; view: 'grid' | 'list'; selected: Set<string>; busy: boolean; syncing: string | null; toggling: string | null; reorder: boolean; dragOver: number | null }>()
defineEmits<{ select: [id: string]; toggle: [source: PlaylistSource]; sync: [source: PlaylistSource]; 'drag-start': [index: number, event: DragEvent]; 'drag-over': [index: number]; 'drag-leave': []; drop: [index: number]; 'drag-end': [] }>()
const broken = reactive(new Set<string>())
</script>

<style scoped>
.library-collection {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: var(--space-6);
}
.collection-item {
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  padding: var(--space-2_5);
  transition:
    background var(--duration-fast) ease,
    border-color var(--duration-fast) ease;
}
.collection-item:hover,
.collection-item:focus-within {
  background: var(--bg-surface);
  border-color: var(--border-primary);
}
.collection-item.is-selected {
  background: var(--accent-muted);
  border-color: var(--accent);
}
.collection-item.is-drag-over {
  outline: 2px solid var(--accent);
}
.collection-item__art {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  box-shadow: var(--shadow-sm);
}
.collection-item__art > a {
  display: block;
  width: 100%;
  height: 100%;
}
.collection-item__art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.collection-item__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
  width: 100%;
  height: 100%;
  color: var(--accent);
  background: var(--accent-muted);
}
.collection-item[data-tint="1"] .collection-item__placeholder {
  background: var(--run-sync-soft);
  color: var(--run-sync);
}
.collection-item[data-tint="2"] .collection-item__placeholder {
  background: var(--run-download-soft);
  color: var(--run-download);
}
.collection-item[data-tint="3"] .collection-item__placeholder {
  background: var(--run-repair-soft);
  color: var(--run-repair);
}
.collection-item__placeholder span {
  font-size: var(--text-xs);
  letter-spacing: 0.2em;
}
.collection-item__select {
  position: absolute;
  left: 0.5rem;
  top: 0.5rem;
  padding: var(--space-2);
  line-height: 0;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  opacity: 0;
}
.collection-item:hover .collection-item__select,
.collection-item:focus-within .collection-item__select,
.collection-item__select.is-visible {
  opacity: 1;
}
.collection-item__grip {
  position: absolute;
  top: 0.7rem;
  right: 0.7rem;
  color: var(--text-primary);
}
.collection-item__kind {
  position: absolute;
  bottom: 0.65rem;
  left: 0.65rem;
  padding: var(--space-1) var(--space-2);
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}
.collection-item__body {
  padding: var(--space-3_5) var(--space-0_5) var(--space-1);
  min-width: 0;
}
.collection-item__title {
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}
.collection-item__meta {
  display: flex;
  gap: var(--space-1_5);
  margin: var(--space-1_5) 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.collection-item__target {
  display: flex;
  align-items: center;
  gap: var(--space-1_5);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.collection-item__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2_5) var(--space-0_5);
  font-size: var(--text-xs);
}
.collection-item__status small {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.collection-item__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1_5);
  padding: var(--space-2) 0 0;
  border-top: 1px solid var(--border-primary);
}
.collection-item__issue {
  margin-right: auto;
  color: var(--warning);
  font-size: var(--text-xs);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.library-collection--list {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.library-collection--list .collection-item {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 9rem auto;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3_5) var(--space-4);
  border-radius: 0;
  border-bottom: 1px solid var(--border-primary);
}
.library-collection--list .collection-item:last-child {
  border-bottom: 0;
}
.library-collection--list .collection-item__kind,
.library-collection--list .collection-item__placeholder span {
  display: none;
}
.library-collection--list .collection-item__body {
  padding: 0;
}
.library-collection--list .collection-item__status {
  display: grid;
  justify-content: start;
  gap: var(--space-1);
}
.library-collection--list .collection-item__actions {
  border: 0;
  padding: 0;
}
.library-collection--list .collection-item__select {
  left: 0.2rem;
  top: 0.2rem;
  padding: var(--space-1_5);
}
.library-collection--list .collection-item__placeholder :deep(svg) {
  width: 24px;
  height: 24px;
}
@media (max-width: 767px) {
  .library-collection {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4) var(--space-2);
  }
  .collection-item {
    padding: var(--space-1_5);
  }
  .collection-item__select {
    opacity: 1;
    padding: var(--space-1_5);
  }
  .collection-item__title {
    font-size: var(--text-base);
  }
  .collection-item__meta {
    font-size: var(--text-xs);
  }
  .collection-item__target {
    display: none;
  }
  .collection-item__status {
    align-items: start;
    flex-direction: column;
  }
  .collection-item__actions {
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .collection-item__issue {
    width: 100%;
  }
  .collection-item__actions .btn {
    flex: 1;
    padding-inline: var(--space-2);
  }
  .library-collection--list .collection-item {
    grid-template-columns: 48px minmax(0, 1fr);
    gap: var(--space-3);
  }
  .library-collection--list .collection-item__status {
    grid-column: 2;
    display: flex;
  }
  .library-collection--list .collection-item__actions {
    grid-column: 2;
    justify-content: start;
  }
  .library-collection--list .collection-item__art {
    align-self: start;
  }
  .library-collection--list .collection-item__placeholder :deep(svg) {
    width: 20px;
    height: 20px;
  }
}
</style>
