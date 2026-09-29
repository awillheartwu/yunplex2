<template>
  <div class="sync-sources-page page-stack">
    <SourceRequestResults :results="sourceRequestResults" @dismiss="sourceRequestResults = []" />
    <PageHeader
      description="收藏的歌单与专辑，都在这里。"
    >
      <template #actions>
        <button class="btn btn-secondary btn-sm sync-sources-page__toolbar-button" type="button" :disabled="loading" @click="refreshSources">
          <AppIcon :name="loading ? 'loader' : 'refresh'" :size="14" :class="loading ? 'animate-spin' : ''" />
          刷新
        </button>
        <button class="btn btn-primary btn-sm sync-sources-page__toolbar-button" type="button" @click="openAddPlaylist">
          <AppIcon name="plus" :size="15" />
          添加歌单
        </button>
      </template>
    </PageHeader>

    <div class="library-heading">
    <PageTabs
      :model-value="filterType"
      :tabs="sourcePageTabs"
      aria-label="来源类型"
      @change="onSourceTabChange"
    />

    <div class="library-facts"><span><strong>{{ totalSourceCount }}</strong> 个收藏</span><span><strong>{{ enabledCount }}</strong> 个自动管理</span><span v-if="totalActionableFailures" class="text-warning">{{ totalActionableFailures }} 个待处理问题</span><span v-if="totalCopyright">{{ totalCopyright }} 首版权受限</span></div>
    </div>

    <div class="library-controls">
    <FilterBar
      :search="sourceSearch"
      placeholder="搜索名称、歌单 ID、Plex 名称或来源 ID"
      search-label="搜索同步源"
      :active-count="advancedFilterCount"
      :can-clear="sourceCanClear"
      advanced
      :advanced-label="advancedFilterLabel"
      advanced-title="筛选条件"
      @update:search="onSourceSearchInput"
      @clear="clearSourceFilters"
      @advanced-open="prepareDraftFilters"
    >
      <template #advanced>
        <div class="filter-sheet-group">
          <p class="filter-sheet-group__label">状态</p>
          <div class="filter-sheet-group__controls">
            <FilterChip :active="draftEnabledFilter === ''" @click="draftEnabledFilter = ''">全部</FilterChip>
            <FilterChip :active="draftEnabledFilter === 'enabled'" @click="draftEnabledFilter = 'enabled'">已启用</FilterChip>
            <FilterChip :active="draftEnabledFilter === 'disabled'" @click="draftEnabledFilter = 'disabled'">已禁用</FilterChip>
          </div>
        </div>
        <div class="filter-sheet-group">
          <p class="filter-sheet-group__label">最近结果</p>
          <div class="filter-sheet-group__controls">
            <FilterChip
              v-for="option in statusFilterOptions"
              :key="option.value || 'all-status'"
              :active="draftStatusFilter === option.value"
              @click="draftStatusFilter = option.value"
            >{{ option.label }}</FilterChip>
          </div>
        </div>
        <div class="filter-sheet-group">
          <p class="filter-sheet-group__label">特殊条件</p>
          <div class="filter-sheet-group__controls">
            <FilterChip :active="draftSubscribedFilter === 'subscribed'" @click="draftSubscribedFilter = draftSubscribedFilter === 'subscribed' ? '' : 'subscribed'">网易云收藏歌单</FilterChip>
            <FilterChip :active="draftIssueFilter === 'failures'" @click="draftIssueFilter = draftIssueFilter === 'failures' ? '' : 'failures'">有待处理异常</FilterChip>
            <FilterChip :active="draftIssueFilter === 'copyright'" @click="draftIssueFilter = draftIssueFilter === 'copyright' ? '' : 'copyright'">版权受限</FilterChip>
          </div>
        </div>
        <div class="filter-sheet-group">
          <p class="filter-sheet-group__label">Plex 目标</p>
          <div class="filter-sheet-group__controls">
            <FilterChip :active="draftPlexTargetFilter === ''" @click="draftPlexTargetFilter = ''">全部</FilterChip>
            <FilterChip :active="draftPlexTargetFilter === 'bound'" @click="draftPlexTargetFilter = 'bound'">已绑定 Plex 目标</FilterChip>
            <FilterChip :active="draftPlexTargetFilter === 'unbound'" @click="draftPlexTargetFilter = 'unbound'">未绑定 Plex 目标</FilterChip>
          </div>
          <p class="text-xs text-muted">按已记录的目标 ID 筛选，不代表目标当前在线或已完成同步。</p>
        </div>
      </template>

      <template #advanced-footer="{ close }">
        <button class="btn btn-secondary" type="button" @click="resetDraftFilters">重置</button>
        <button class="btn btn-primary" type="button" @click="applyDraftFilters(close)">应用</button>
      </template>

      <template #active-filters>
        <button
          v-for="chip in sourceFilterChips"
          :key="chip.key"
          type="button"
          class="filter-chip filter-chip-active filter-chip--removable"
          :aria-label="`移除筛选：${chip.label}`"
          @click="removeSourceFilter(chip.key)"
        >
          <span>{{ chip.label }}</span>
          <span class="filter-chip__remove" aria-hidden="true">
            <AppIcon name="close" :size="12" />
          </span>
        </button>
      </template>

      <template #batch>
        <div v-if="selectedCount > 0" class="section-card sync-batch-bar" role="region" aria-live="polite" aria-label="批量操作">
          <div class="sync-batch-bar__summary">
            <span class="sync-batch-bar__count">已选择 {{ selectedCount }} 项</span>
          </div>
          <div class="sync-batch-bar__actions">
            <button class="btn btn-secondary btn-xs" type="button" :disabled="!canBatchSyncSelected" @click="runSelectedBatch('sync')">
              <AppIcon :name="batchLoading ? 'loader' : 'sync'" :size="14" :class="batchLoading ? 'animate-spin' : ''" />
              同步
            </button>
            <button class="btn btn-secondary btn-xs" type="button" :disabled="!canBatchToggleSelected || batchToggling" @click="runSelectedBatch('enable')">
              <AppIcon name="check" :size="14" />
              启用
            </button>
            <button class="btn btn-secondary btn-xs" type="button" :disabled="!canBatchToggleSelected || batchToggling" @click="runSelectedBatch('disable')">
              <AppIcon name="minus" :size="14" />
              禁用
            </button>
          </div>
        </div>
      </template>

    </FilterBar>

    <div class="library-viewbar"><label class="library-select-all"><input type="checkbox" :checked="allVisibleSelected" :indeterminate="someVisibleSelected" aria-label="选择全部收藏" @change="toggleSelectAllVisible">全选筛选结果</label><span>{{ orderedSources.length }} 个{{ filterType === 'album' ? '专辑' : '歌单' }}</span><div class="library-viewbar__right"><select v-model="sort" class="form-input" aria-label="收藏排序"><option value="manual">自定义顺序</option><option value="name">名称 A–Z</option><option value="recent">最近更新</option></select><div class="library-view-toggle" aria-label="收藏展示方式"><button class="icon-button" aria-label="网格视图" :aria-pressed="view === 'grid'" @click="view = 'grid'"><AppIcon name="dashboard" :size="17" /></button><button class="icon-button" aria-label="列表视图" :aria-pressed="view === 'list'" @click="view = 'list'"><AppIcon name="list" :size="17" /></button></div></div></div>
    </div>
    <div v-if="loading" class="flex items-center justify-center py-16">
      <span class="text-muted text-sm">加载中...</span>
    </div>

    <div v-else-if="loadError" class="library-load-error" role="alert"><h2>无法读取音乐库</h2><p>{{ loadError }}</p><button class="btn btn-secondary" @click="refreshSources">重新加载</button></div>
    <div v-else-if="filteredSources.length === 0" class="section-card">
      <EmptyState
        :title="hasResultFilters ? '没有匹配的收藏' : filterType === 'album' ? '暂无已保存专辑' : '还没有收藏歌单'"
        :description="hasResultFilters ? '试试其他关键词，或清除筛选查看全部收藏。' : filterType === 'album' ? '从添加音乐页面可将专辑保存到音乐库' : '添加网易云歌单 ID 以开始同步管理'"
      >
        <template #default>
          <button v-if="hasResultFilters" class="btn btn-secondary" @click="clearSourceFilters">清除筛选</button>
          <button v-else-if="filterType !== 'album'" class="btn btn-primary mt-4" @click="openAddPlaylist">添加歌单</button>
          <NuxtLink v-else to="/manual-download" class="btn btn-primary mt-4 inline-block">去添加音乐</NuxtLink>
        </template>
      </EmptyState>
    </div>

    <LibraryCollection v-else :sources="pageSources" :view="view" :selected="selectedSourceIds" :busy="isAnySyncing" :syncing="syncingSourceId" :toggling="togglingId" :reorder="canDragReorder && sort === 'manual'" :drag-over="dragOverIdx === null ? null : dragOverIdx - pageOffset" @select="toggleSourceSelection" @toggle="toggleEnabled" @sync="s => s.type === 'playlist' ? syncSource(s) : syncSource(s, true)" @drag-start="(index, event) => onFilteredDragStart(pageOffset + index, event)" @drag-over="index => onFilteredDragOver(pageOffset + index)" @drag-leave="onDragLeave" @drop="index => onFilteredDrop(pageOffset + index)" @drag-end="onDragEnd" />

    <PageNavigator v-if="!loading && !loadError" :page="page" :page-size="pageSize" :total="orderedSources.length" label="收藏" @change="changePage" />

    <!-- Dialogs -->
    <AddPlaylistDialog
      :visible="showAdd"
      :source-ids="allSources.map(s => s.neteasePlaylistId)"
      @update:visible="showAdd = $event"
      @created="onPlaylistCreated"
      @created-album="onAlbumCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { useSyncSourcesPage } from '~/composables/useSyncSourcesPage'
const {
  loadError, sourceRequestResults, advancedFilterCount, advancedFilterLabel, allSources, allVisibleSelected, applyDraftFilters, batchLoading, batchToggling, canBatchSyncSelected, canBatchToggleSelected, canDragReorder, clearSourceFilters, draftEnabledFilter, draftIssueFilter, draftStatusFilter, draftSubscribedFilter, draftPlexTargetFilter, dragOverIdx, enabledCount, filteredSources, filterType, isAnySyncing, loading, onAlbumCreated, onDragEnd, onDragLeave, onFilteredDragOver, onFilteredDragStart, onFilteredDrop, onPlaylistCreated, onSourceSearchInput, onSourceTabChange, openAddPlaylist, prepareDraftFilters, refreshSources, removeSourceFilter, resetDraftFilters, runSelectedBatch, selectedCount, selectedSourceIds, showAdd, someVisibleSelected, sourceCanClear, sourceFilterChips, sourcePageTabs, sourceSearch, statusFilterOptions, syncingSourceId, syncSource, toggleEnabled, toggleSelectAllVisible, toggleSourceSelection, togglingId, totalActionableFailures, totalCopyright, totalSourceCount
} = useSyncSourcesPage()
const view = ref<'grid' | 'list'>('grid')
const sort = ref('manual')
const orderedSources = computed(() => {
  if (sort.value === 'manual') return filteredSources.value
  return [...filteredSources.value].sort((a, b) => sort.value === 'name' ? (a.name || a.neteasePlaylistName).localeCompare(b.name || b.neteasePlaylistName, 'zh-CN') : (b.lastSyncedAt || b.updatedAt).localeCompare(a.lastSyncedAt || a.updatedAt))
})
const hasResultFilters = computed(() => Boolean(sourceSearch.value.trim()) || advancedFilterCount.value > 0)
const pageSize = 60
const page = ref(1)
const pageCount = computed(() => Math.max(1, Math.ceil(orderedSources.value.length / pageSize)))
const pageOffset = computed(() => (page.value - 1) * pageSize)
const pageSources = computed(() => orderedSources.value.slice(pageOffset.value, pageOffset.value + pageSize))
watch(pageCount, count => { if (page.value > count) page.value = count })
watch([sort, sourceSearch, filterType, () => JSON.stringify(sourceFilterChips.value)], () => { page.value = 1; onDragEnd() })
function changePage(next: number) {
  onDragEnd()
  page.value = Math.min(pageCount.value, Math.max(1, next))
  void nextTick(() => document.querySelector('.library-viewbar')?.scrollIntoView({ block: 'start' }))
}
onMounted(() => { try { if (localStorage.getItem('reyunplex-library-view') === 'list') view.value = 'list' } catch { /* Keep the default view if storage is unavailable. */ } })
watch(view, value => { try { localStorage.setItem('reyunplex-library-view', value) } catch { /* The selected view still works without storage. */ } })
</script>

<style>

.library-load-error{display:grid;justify-items:start;gap:var(--space-3);padding:var(--space-8);border:1px solid var(--danger-border);border-radius:var(--radius-lg);color:var(--danger);background:var(--danger-soft)}
.library-facts{display:flex;flex-wrap:wrap;gap:var(--space-6);padding:var(--space-1) 0;color:var(--text-secondary);font-size:var(--text-sm)}.library-facts strong{font-weight:var(--font-weight-semibold);color:var(--text-primary)}.library-viewbar{display:flex;align-items:center;gap:var(--space-4);color:var(--text-tertiary);font-size:var(--text-xs)}.library-viewbar__right{display:flex;gap:var(--space-3);margin-left:auto}.library-viewbar select{width:9rem;font-size:var(--text-base);min-height:var(--control-height)}.library-view-toggle{display:flex;gap:var(--space-1)}.library-view-toggle button{min-height:var(--control-height);min-width:var(--control-height)}.library-view-toggle button[aria-pressed="true"]{background:var(--bg-surface);color:var(--accent);border-color:var(--accent)}.library-select-all{display:flex;align-items:center;gap:var(--space-2);min-height:44px}.sync-batch-bar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);padding:var(--space-3) var(--space-4);background:var(--accent-muted);border-color:var(--accent)}.sync-batch-bar__actions{display:flex;flex-wrap:wrap;gap:var(--space-1_5)}.sync-sources-page .page-tabs{width:max-content;max-width:100%}.library-viewbar+div{min-width:0}@media(max-width:767px){.library-facts{gap:var(--space-2) var(--space-4)}.library-viewbar{flex-wrap:wrap;gap:var(--space-2)}.library-viewbar__right{gap:var(--space-1_5)}.library-viewbar select{width:8rem}.sync-batch-bar{align-items:stretch;flex-direction:column}}
.library-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.library-controls { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
@media(max-width:720px) { .library-heading { align-items: flex-start; flex-direction: column; } }
</style>
