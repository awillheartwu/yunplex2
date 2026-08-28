<template>
  <section class="run-records space-y-4">
    <FilterBar
      :search="runs.filter.value.search || ''"
      placeholder="搜索运行摘要、ID、来源或歌曲"
      search-label="搜索运行记录"
      :active-count="advancedFilterCount"
      :can-clear="canClear"
      advanced
      :advanced-label="advancedFilterLabel"
      advanced-title="筛选条件"
      @update:search="onSearch"
      @clear="clearFilters"
      @advanced-open="prepareDraftFilters"
    >
      <template #advanced>
        <div class="filter-sheet-group">
          <p class="filter-sheet-group__label">运行类型</p>
          <div class="filter-sheet-group__controls">
            <FilterChip v-for="item in typeFilters" :key="item.value || 'all'" :active="draftType === item.value" @click="draftType = item.value">{{ item.label }}</FilterChip>
          </div>
        </div>
        <div class="filter-sheet-group">
          <p class="filter-sheet-group__label">运行状态</p>
          <div class="filter-sheet-group__controls">
            <FilterChip v-for="item in statusFilters" :key="item.value || 'all'" :active="draftStatus === item.value" @click="draftStatus = item.value">{{ item.label }}</FilterChip>
          </div>
        </div>
        <div class="filter-sheet-group">
          <label class="filter-sheet-group__label" for="run-source-filter">来源</label>
          <select id="run-source-filter" v-model="draftSource" class="form-input">
            <option value="">全部来源</option>
            <option v-for="source in sourceOptions" :key="source.id" :value="source.id">{{ sourceOptionLabel(source) }}</option>
          </select>
        </div>
        <FilterDateRange :model-value="draftDateFilter" :min-date="runs.earliestDate.value" @update:model-value="setDraftDate" />
      </template>

      <template #advanced-footer="{ close }">
        <button class="btn btn-secondary" type="button" @click="resetDraftFilters">重置</button>
        <button class="btn btn-primary" type="button" @click="applyDraftFilters(close)">应用</button>
      </template>

      <template #active-filters>
        <button v-for="chip in filterChips" :key="chip.key" type="button" class="filter-chip filter-chip-active filter-chip--removable" :aria-label="`移除筛选：${chip.label}`" @click="removeFilter(chip.key)">
          <span>{{ chip.label }}</span>
          <span class="filter-chip__remove" aria-hidden="true"><AppIcon name="close" :size="12" /></span>
        </button>
      </template>

      <template #actions>
        <button class="btn btn-secondary btn-xs" type="button" :disabled="runs.loading.value" @click="runs.fetch()">
          <AppIcon :name="runs.loading.value ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': runs.loading.value }" />
          刷新
        </button>
      </template>
      <template #summary><span v-if="runs.total.value > 0">共 {{ runs.total.value }} 次运行</span></template>
    </FilterBar>

    <div v-if="runs.loading.value && runs.items.value.length === 0" class="run-records__loading">正在加载运行记录…</div>
    <EmptyState v-else-if="runs.items.value.length === 0" title="暂无运行记录" description="当前筛选条件下没有匹配的运行" />
    <div v-else class="run-groups">
      <section v-for="group in groupedRuns" :key="group.key" class="run-group">
        <h3>{{ group.label }}</h3>
        <div class="run-group__list"><RunCard v-for="run in group.items" :key="run.id" :run="run" /></div>
      </section>
      <Pagination :has-more="runs.hasMore.value" :loading="runs.loadingMore.value" :current-count="runs.items.value.length" :total="runs.total.value" @load-more="runs.loadMore()" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useRunHistory } from '~~/composables/useRunHistory'

const {
  advancedFilterCount, advancedFilterLabel, applyDraftFilters, canClear, clearFilters,
  draftDateFilter, draftSource, draftStatus, draftType, filterChips, groupedRuns, onSearch,
  prepareDraftFilters, removeFilter, resetDraftFilters, runs, setDraftDate, sourceOptionLabel,
  sourceOptions, statusFilters, typeFilters,
} = useRunHistory()
</script>

<style scoped>
@import '~/assets/css/pages/task-center.css';
.run-records{padding-bottom:.5rem}
.run-records__loading{display:flex;min-height:12rem;align-items:center;justify-content:center;color:var(--text-secondary);font-size:.85rem}
</style>
