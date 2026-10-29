<template>
  <div class="job-song-filters" role="group" aria-label="按本次明细的歌曲状态筛选">
    <button
      type="button"
      class="job-song-filter"
      :class="{ 'is-active': model === 'all' }"
      :aria-pressed="model === 'all'"
      @click="model = 'all'"
    >
      <AppIcon name="list" :size="12" /><span>全部</span><strong>{{ songs.length }}</strong>
    </button>
    <div v-for="group in groups" :key="group.key" class="job-song-filter-group" :class="{ 'is-active': group.active }">
      <button
        type="button"
        class="job-song-filter"
        :aria-pressed="group.active"
        :aria-label="`${group.selected ? `${group.selected.label} ${group.selected.count} 项，` : ''}筛选全部${group.label} ${group.count} 项`"
        @click="model = group.key"
      >
        <AppIcon :name="group.icon" :size="12" /><span>{{ group.selected?.label ?? group.label }}</span>
        <strong :class="semanticToneClass(group.selected?.tone ?? group.tone)">{{
          group.selected?.count ?? group.count
        }}</strong>
      </button>
      <span class="job-song-filter-group__select" title="展开具体状态">
        <AppIcon name="chevronDown" :size="12" />
        <select
          :value="group.selected?.key ?? (model === group.key ? group.key : '')"
          :aria-label="`${group.label}细分`"
          :disabled="group.children.length === 0 && !group.active"
          @change="select($event)"
        >
          <option value="" disabled>选择具体状态</option>
          <option v-if="group.count > 0 || model === group.key" :value="group.key">{{ group.label }}（全部） {{ group.count }}</option>
          <option v-if="group.key === 'attention' && (group.failureCount > 0 || model === 'failure')" value="failure">失败（全部） {{ group.failureCount }}</option>
          <option v-for="item in group.children" :key="item.key" :value="item.key">
            {{ item.label }} {{ item.count }}
          </option>
        </select>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SongStatus } from '~~/server/lib/job/types'
import {
  semanticToneClass,
  SONG_STATUS_BUCKETS,
  SONG_STATUS_GROUPS,
  songStatusBucketCount,
  type SongStatusBucketPresentation,
  type SongStatusFilter,
} from '~~/lib/task-status'
const props = defineProps<{ songs: readonly { status: SongStatus }[] }>()
const model = defineModel<SongStatusFilter>({ required: true })
const allFailures: SongStatusBucketPresentation = {
  key: 'failure',
  label: '失败（全部）',
  tone: 'failure',
  icon: 'failure',
}
const groups = computed(() =>
  SONG_STATUS_GROUPS.map((group) => {
    const children = group.buckets
      .flatMap((key) => SONG_STATUS_BUCKETS.filter((item) => item.key === key))
      .map((item) => ({
        ...item,
        count: songStatusBucketCount(props.songs, item.key),
      }))
    const failureCount = songStatusBucketCount(props.songs, 'failure')
    const selected = children.find((item) => item.key === model.value)
      ?? (group.key === 'attention' && model.value === 'failure' ? { ...allFailures, count: failureCount } : undefined)
    return {
      ...group,
      selected,
      active: model.value === group.key || Boolean(selected),
      count: children.reduce((sum, item) => sum + item.count, 0),
      failureCount,
      children: children.filter((item) => item.count > 0 || item.key === model.value),
    }
  }).filter((group) => group.key !== 'in_progress' || group.count > 0 || group.active),
)
function select(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value) model.value = value as SongStatusFilter
}
</script>

<style scoped>
.job-song-filters {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  overflow-x: auto;
  padding: var(--space-1);
}
.job-song-filter-group {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  border-radius: var(--radius-md);
}
.job-song-filter {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-1_5);
  min-height: 2.25rem;
  padding: var(--space-1_5) var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
}
.job-song-filter:hover {
  background: var(--bg-hover);
}
.job-song-filter.is-active,
.job-song-filter-group.is-active {
  background: var(--accent-muted);
  color: var(--accent);
}
.job-song-filter-group.is-active .job-song-filter {
  color: var(--accent);
}
.job-song-filter strong {
  min-width: 1.25rem;
  padding: var(--space-0_5) var(--space-1_5);
  border-radius: var(--radius-full);
  background: var(--bg-app);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.job-song-filter:focus-visible,
.job-song-filter-group__select:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.job-song-filter-group__select {
  position: relative;
  display: grid;
  align-items: center;
  justify-items: center;
  align-self: stretch;
  min-width: 1.75rem;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
}
.job-song-filter-group__select:hover {
  background: var(--bg-hover);
}
.job-song-filter-group__select select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
@media (max-width: 720px) {
  .job-song-filter {
    min-height: 2.75rem;
  }
  .job-song-filter-group__select {
    min-width: 2.75rem;
  }
}
</style>
