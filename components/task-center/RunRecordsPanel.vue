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
          <FilterSegmentGroup v-model="draftType" aria-label="运行类型" :options="typeFilters" />
        </div>
        <div class="filter-sheet-group">
          <p class="filter-sheet-group__label">运行状态</p>
          <FilterSegmentGroup v-model="draftStatus" aria-label="运行状态" :options="statusFilters" />
        </div>
        <div class="filter-sheet-group">
          <ListSelect v-model="draftSource" class="list-select--block" label="来源" aria-label="来源" :options="sourceSelectOptions" />
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

    <div v-if="runs.error.value" class="run-records__error" role="alert">
      <span>运行记录读取失败：{{ runs.error.value }}</span>
      <button class="btn btn-secondary btn-sm" type="button" :disabled="runs.loading.value" @click="runs.fetch()">重新加载</button>
    </div>
    <div v-if="runs.loading.value && runs.items.value.length === 0" class="run-records__loading">正在加载运行记录…</div>
    <EmptyState v-else-if="!runs.error.value && runs.items.value.length === 0" title="暂无运行记录" description="当前筛选条件下没有匹配的运行" />
    <div v-else ref="listRoot" class="run-groups">
      <section v-for="group in groupedRuns" :key="group.key" class="run-group">
        <div class="run-group__heading"><h3>{{ group.label }}</h3><span>{{ group.items.length }} 次运行</span></div>
        <div class="run-group__list"><RunCard v-for="run in group.items" :key="run.id" :run="run" /></div>
      </section>
      <PageNavigator :page="runs.page.value" :page-size="runs.pageSize" :total="runs.total.value" label="运行记录" :loading="runs.loading.value" @change="changePage" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useRunHistory } from '~~/composables/useRunHistory'

const {
  advancedFilterCount, advancedFilterLabel, applyDraftFilters, canClear, clearFilters,
  draftDateFilter, draftSource, draftStatus, draftType, filterChips, groupedRuns, onSearch,
  prepareDraftFilters, removeFilter, resetDraftFilters, runs, setDraftDate,
  sourceOptionLabel, sourceOptions, statusFilters, typeFilters,
} = useRunHistory()
const listRoot = ref<HTMLElement | null>(null)
async function changePage(page: number) {
  const previous = runs.page.value
  await runs.goToPage(page)
  if (runs.page.value !== previous) { await nextTick(); listRoot.value?.scrollIntoView({ block: 'start' }) }
}
const sourceSelectOptions = computed(() => [{ value: '', label: '全部来源' }, ...sourceOptions.value.map(source => ({ value: source.id, label: sourceOptionLabel(source) }))])
</script>

<style scoped>
@import '~/assets/css/pages/task-center.css';
.run-records{padding-bottom:var(--space-2)}
.run-records__loading{display:flex;min-height:12rem;align-items:center;justify-content:center;color:var(--text-secondary);font-size:var(--text-base)}
.run-records__error{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--danger-border);border-radius:var(--radius-md);background:var(--danger-soft);color:var(--danger);font-size:var(--text-sm)}
.run-groups{display:flex;flex-direction:column;gap:var(--space-6)}
.run-group__heading{display:flex;align-items:baseline;gap:var(--space-2);margin-bottom:var(--space-2)}
.run-group__heading h3{margin:0}
.run-group__heading span{font-size:var(--text-xs);color:var(--text-tertiary)}
</style>
