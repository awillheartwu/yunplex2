<template>
  <div class="sync-sources-page space-y-6">
    <PageHeader
      description="长期管理网易云歌单同步源，支持自动同步、增量比较与排序修复"
    >
      <template #actions>
        <button class="btn btn-secondary btn-sm sync-sources-page__toolbar-button" type="button" :disabled="loading" @click="refreshSources">
          <AppIcon :name="loading ? 'loader' : 'refresh'" :size="14" :class="loading ? 'animate-spin' : ''" />
          刷新
        </button>
        <button class="btn btn-primary btn-sm sync-sources-page__toolbar-button" type="button" @click="openAddPlaylist">
          <AppIcon name="plus" :size="15" />
          添加同步源
        </button>
      </template>
    </PageHeader>

    <div class="grid grid-cols-2 gap-3 xl:grid-cols-5">
      <article class="section-card sync-summary-card">
        <div class="sync-summary-card__icon sync-summary-card__icon--primary">
          <AppIcon name="folder" :size="18" />
        </div>
        <div>
          <p class="sync-summary-card__label">同步源总数</p>
          <p class="sync-summary-card__value">{{ totalSourceCount }}</p>
        </div>
      </article>
      <article class="section-card sync-summary-card">
        <div class="sync-summary-card__icon sync-summary-card__icon--success">
          <AppIcon name="sync" :size="18" />
        </div>
        <div>
          <p class="sync-summary-card__label">已启用</p>
          <p class="sync-summary-card__value">{{ enabledCount }}</p>
        </div>
      </article>
      <article class="section-card sync-summary-card">
        <div class="sync-summary-card__icon sync-summary-card__icon--muted">
          <AppIcon name="clock" :size="18" />
        </div>
        <div>
          <p class="sync-summary-card__label">上次同步</p>
          <p class="sync-summary-card__value sync-summary-card__value--status" :class="lastSyncTime ? 'text-success' : 'text-muted-deep'">
            {{ lastSyncTime || '尚未同步' }}
          </p>
        </div>
      </article>
      <article class="section-card sync-summary-card">
        <div class="sync-summary-card__icon sync-summary-card__icon--ignored">
          <AppIcon name="warn" :size="18" />
        </div>
        <div>
          <p class="sync-summary-card__label">忽略歌曲</p>
          <p class="sync-summary-card__value" :class="totalIgnored > 0 ? 'text-ignored' : 'text-muted-deep'">{{ totalIgnored }}</p>
        </div>
      </article>
      <article class="section-card sync-summary-card">
        <div class="sync-summary-card__icon sync-summary-card__icon--ignored">
          <AppIcon name="shield" :size="18" />
        </div>
        <div>
          <p class="sync-summary-card__label">版权受限</p>
          <p class="sync-summary-card__value" :class="totalCopyright > 0 ? 'text-ignored' : 'text-muted-deep'">{{ totalCopyright }}</p>
        </div>
      </article>
    </div>

    <PageTabs
      :model-value="filterType"
      :tabs="sourcePageTabs"
      aria-label="来源类型"
      @change="onSourceTabChange"
    />

    <FilterBar
      :search="sourceSearch"
      placeholder="搜索名称、歌单 ID、Plex 名称或来源 ID"
      search-label="搜索同步源"
      :active-count="advancedFilterCount"
      :can-clear="sourceCanClear"
      advanced
      :advanced-label="advancedFilterLabel"
      advanced-title="高级筛选"
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
            <FilterChip :active="draftSubscribedFilter === 'subscribed'" @click="draftSubscribedFilter = draftSubscribedFilter === 'subscribed' ? '' : 'subscribed'">已绑定目标</FilterChip>
            <FilterChip :active="draftIssueFilter === 'ignored'" @click="draftIssueFilter = draftIssueFilter === 'ignored' ? '' : 'ignored'">有忽略</FilterChip>
            <FilterChip :active="draftIssueFilter === 'copyright'" @click="draftIssueFilter = draftIssueFilter === 'copyright' ? '' : 'copyright'">版权受限</FilterChip>
          </div>
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
            <button class="btn btn-danger btn-xs" type="button" :disabled="batchDeleting" @click="openBatchDeleteConfirm">
              <AppIcon name="trash" :size="14" />
              删除
            </button>
          </div>
        </div>
      </template>
      <template #summary>
        <div class="sync-sources-page__list-summary">
          <span>显示 {{ filteredSources.length }} 个来源</span>
          <span v-if="!canDragReorder">筛选中已暂停拖拽排序</span>
        </div>
      </template>
    </FilterBar>

    <div v-if="loading" class="flex items-center justify-center py-16">
      <span class="text-muted text-sm">加载中...</span>
    </div>

    <div v-else-if="filteredSources.length === 0" class="section-card p-8">
      <EmptyState
        :title="filterType === 'album' ? '暂无已保存专辑' : '暂无同步源'"
        :description="filterType === 'album' ? '从手动下载页面可将专辑保存为来源' : '添加网易云歌单 ID 以开始同步管理'"
      >
        <template #extra>
          <button v-if="filterType !== 'album'" class="btn btn-primary mt-4" @click="openAddPlaylist">添加同步源</button>
          <NuxtLink v-else to="/manual-download" class="btn btn-primary mt-4 inline-block">去手动下载</NuxtLink>
        </template>
      </EmptyState>
    </div>

    <section v-else ref="tableShellRef" class="section-card sync-table-shell overflow-hidden">
      <div class="hidden md:block overflow-x-auto">
        <table
          class="sync-table"
          :class="[
            `sync-table--${desktopActionDensity}`,
            filterType === 'album' ? 'sync-table--album' : 'sync-table--playlist',
          ]"
        >
          <thead>
            <tr>
              <th class="sync-table__control-col">
                <div class="sync-table__header-controls">
                  <input
                    type="checkbox"
                    :checked="allVisibleSelected"
                    :indeterminate="someVisibleSelected"
                    :disabled="filteredSources.length === 0"
                    aria-label="选择当前筛选结果"
                    @change="toggleSelectAllVisible"
                  >
                  <span>选择</span>
                </div>
              </th>
              <th>歌单 / 来源</th>
              <th>Plex 名称</th>
              <th class="text-right">歌曲数</th>
              <th class="text-right">忽略</th>
              <th>{{ filterType === 'album' ? '下载信息' : '同步信息' }}</th>
              <th class="sync-table__actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(s, idx) in filteredSources" :key="s.id">
              <tr
                :draggable="canDragReorder ? 'true' : 'false'"
                class="sync-table__row"
                :class="[
                  dragOverIdx === idx ? 'sync-table__row--drag-over' : '',
                  dragIdx === idx ? 'opacity-50' : '',
                  expandedId === s.id ? 'sync-table__row--expanded' : '',
                ]"
                @dragstart="onFilteredDragStart(idx, $event)"
                @dragover.prevent="onFilteredDragOver(idx)"
                @dragleave="onDragLeave"
                @drop="onFilteredDrop(idx)"
                @dragend="onDragEnd"
              >
                <td class="sync-table__control-col" :class="filterType === 'album' ? 'sync-table__control-col--album' : ''">
                  <div class="sync-table__controls">
                    <input
                      type="checkbox"
                      class="sync-source-checkbox"
                      :checked="selectedSourceIds.has(s.id)"
                      :aria-label="`选择 ${sourceDisplayName(s)}`"
                      @change="toggleSourceSelection(s.id)"
                      @click.stop
                    >
                    <span v-if="canDragReorder" class="sync-drag-handle" aria-hidden="true">
                      <AppIcon name="grip" :size="15" />
                    </span>
                    <button
                      v-if="s.type === 'playlist'"
                      class="sync-toggle"
                      :class="s.enabled ? 'sync-toggle--active' : ''"
                      :title="s.enabled ? '已启用，点击禁用' : '已禁用，点击启用'"
                      :aria-label="s.enabled ? '禁用同步源' : '启用同步源'"
                      :disabled="togglingId === s.id"
                      @click="toggleEnabled(s)"
                    >
                      <span class="sync-toggle__thumb" :class="s.enabled ? 'sync-toggle__thumb--active' : ''" />
                    </button>
                  </div>
                </td>
                <td class="sync-table__source-col">
                  <div
                    class="sync-table__source-trigger"
                    tabindex="0"
                    @mouseenter="showSourceHover(s, $event)"
                    @mouseleave="scheduleHideSourceHover"
                    @focusin="showSourceHover(s, $event)"
                    @focusout="scheduleHideSourceHover"
                  >
                    <div class="sync-table__source-main">
                      <div class="sync-table__cover">
                        <img v-if="s.coverUrl" :src="sourceCoverSrc(s.coverUrl)" :alt="`${sourceDisplayName(s)} 封面`">
                        <div v-else class="sync-table__cover-fallback">
                          <AppIcon :name="s.type === 'album' ? 'album' : 'music'" :size="16" />
                        </div>
                      </div>
                      <div class="min-w-0">
                        <div class="sync-table__source-title">
                          <SourceBadge :type="s.type" :subscribed="s.subscribed" />
                          <span class="sync-table__source-name" :title="sourceDisplayName(s)">{{ sourceDisplayName(s) }}</span>
                        </div>
                        <div class="sync-table__source-meta" :title="sourceMetaLabel(s)">{{ sourceMetaLabel(s) }}</div>
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="sync-table__plex-name" :title="plexTargetName(s)">{{ plexTargetName(s) }}</div>
                  <div class="sync-table__subtle">{{ plexTargetHint(s) }}</div>
                </td>
                <td class="sync-table__metric-col">
                  <div class="sync-table__metric-cell">
                    <div class="sync-table__inline-metric sync-table__inline-metric--compact">
                      <span class="sync-table__numeric">{{ s.trackCount }}</span>
                      <span class="sync-table__metric-unit">首</span>
                    </div>
                  </div>
                </td>
                <td class="sync-table__metric-col">
                  <div class="sync-table__metric-cell sync-table__metric-cell--issue">
                    <button
                      v-if="sourceIssueCount(s) > 0"
                      class="sync-table__issue-link"
                      :title="`忽略 ${sourceIgnoredCount(s)} 首，版权受限 ${sourceCopyrightCount(s)} 首，点击清除忽略记录`"
                      :aria-label="`当前有 ${sourceIssueSummary(s)}，点击清除忽略记录`"
                      @click.stop="clearIgnored(s)"
                    >
                      <span class="sync-table__issue-value sync-table__issue-value--active">{{ sourceIssueCount(s) }}</span>
                      <span class="sync-table__issue-unit">{{ sourceIssueSummary(s) }}</span>
                    </button>
                    <div v-else class="sync-table__issue-static">
                      <span class="sync-table__issue-value">0</span>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="sync-table__result">
                    <span class="sync-result-dot" :class="syncResultDotClass(s)" />
                    <span class="sync-table__result-label" :class="syncResultTextClass(s)">
                      {{ repairingSourceId === s.id ? '补全中' : syncResultLabel(s) }}
                    </span>
                  </div>
                  <p class="sync-table__result-meta">
                    {{ s.lastSyncedAt ? formatRelative(s.lastSyncedAt) : (s.type === 'album' ? '未下载' : '未同步') }}
                  </p>
                  <p v-if="s.lastError && s.lastStatus === 'failed'" class="sync-table__error">{{ s.lastError }}</p>
                </td>
                <td class="sync-table__actions-col">
                  <div class="sync-row-actions">
                    <button
                      class="sync-row-actions__primary"
                      :disabled="isAnySyncing || (s.type === 'playlist' && !s.enabled)"
                      :aria-label="s.type === 'playlist' ? `同步 ${sourceDisplayName(s)}` : `下载 ${sourceDisplayName(s)}`"
                      :title="s.type === 'playlist' ? '同步' : '下载'"
                      @click="s.type === 'playlist' ? syncSource(s) : syncSource(s, true)"
                    >
                      <AppIcon
                        :name="s.type === 'playlist' ? 'sync' : 'download'"
                        :size="14"
                        :class="(syncingSourceId === s.id || forceFullId === s.id) ? 'animate-spin' : ''"
                      />
                      <span>{{ s.type === 'playlist' ? '同步' : '下载' }}</span>
                    </button>
                    <button
                      v-if="showInlineFullSyncAction(s)"
                      class="icon-button sync-row-actions__icon"
                      type="button"
                      aria-label="全量同步"
                      title="全量同步"
                      :disabled="isAnySyncing"
                      @click="syncSource(s, true)"
                    >
                      <AppIcon name="refresh" :size="14" />
                    </button>
                    <button
                      v-if="showInlineRepairAction"
                      class="icon-button sync-row-actions__icon"
                      type="button"
                      aria-label="补词/图"
                      title="补词/图"
                      :disabled="isAnySyncing"
                      @click="repairSource(s)"
                    >
                      <span v-if="repairingSourceId === s.id && repairProgress[s.id]" class="sync-row-actions__progress">
                        {{ repairProgress[s.id].processed }}/{{ repairProgress[s.id].total }}
                      </span>
                      <AppIcon v-else name="music" :size="14" />
                    </button>
                    <button
                      v-if="showInlineEditAction"
                      class="icon-button sync-row-actions__icon"
                      type="button"
                      aria-label="编辑同步源"
                      title="编辑同步源"
                      @click="openEdit(s)"
                    >
                      <AppIcon name="edit" :size="14" />
                    </button>
                    <div class="sync-row-actions__menu">
                      <button class="icon-button sync-row-actions__icon" type="button" aria-label="更多操作" @click.stop="toggleMoreMenu(s.id)">
                        <AppIcon name="more" :size="14" />
                      </button>
                      <div
                        v-if="moreMenuId === s.id"
                        class="sync-row-menu"
                        :class="idx >= filteredSources.length - 3 ? 'sync-row-menu--top' : 'sync-row-menu--bottom'"
                        @click.stop
                      >
                        <button
                          v-if="!showInlineEditAction"
                          class="sync-row-menu__item"
                          type="button"
                          @click="openEdit(s); moreMenuId = null"
                        >
                          <AppIcon name="edit" :size="12" />
                          <span>编辑同步源</span>
                        </button>
                        <button
                          v-if="!showInlineFullSyncAction(s) && s.type === 'playlist'"
                          class="sync-row-menu__item"
                          :disabled="isAnySyncing"
                          @click="syncSource(s, true); moreMenuId = null"
                        >
                          <AppIcon name="refresh" :size="12" />
                          <span>全量同步</span>
                        </button>
                        <button class="sync-row-menu__item" :disabled="isAnySyncing" @click="openRebuildConfirm(s); moreMenuId = null">
                          <AppIcon name="repair" :size="12" />
                          <span>{{ rebuildActionLabel(s) }}</span>
                        </button>
                        <button class="sync-row-menu__item" type="button" @click="toggleExpand(s.id); moreMenuId = null">
                          <AppIcon name="chevronRight" :size="12" />
                          <span>{{ expandedId === s.id ? '收起歌曲明细' : '展开歌曲明细' }}</span>
                        </button>
                        <button
                          v-if="!showInlineRepairAction"
                          class="sync-row-menu__item"
                          :class="repairingSourceId === s.id ? 'sync-row-menu__item--active' : ''"
                          :disabled="isAnySyncing"
                          @click="repairSource(s); moreMenuId = null"
                        >
                          <span v-if="repairingSourceId === s.id && repairProgress[s.id]">{{ repairProgress[s.id].processed }}/{{ repairProgress[s.id].total }}</span>
                          <AppIcon v-else name="music" :size="12" />
                          <span>补词/图</span>
                        </button>
                        <button class="sync-row-menu__item sync-row-menu__item--danger" type="button" @click="confirmDelete = s; moreMenuId = null">
                          <AppIcon name="trash" :size="12" />
                          <span>删除</span>
                        </button>
                      </div>
                      <div v-if="moreMenuId === s.id" class="fixed inset-0 z-10" @click="moreMenuId = null" />
                    </div>
                  </div>
                </td>
              </tr>
              <tr v-if="expandedId === s.id" class="sync-table__expanded-row">
                <td colspan="7">
                  <div class="sync-expanded-panel">
                    <div v-if="expandedLoading" class="text-2xs text-muted py-2">加载中...</div>
                    <div v-else-if="expandedSongs.length === 0" class="text-2xs text-muted py-2">暂无歌曲记录</div>
                    <div v-else class="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-3">
                      <div v-for="song in expandedSongs" :key="song.id" class="flex items-center gap-2 text-xs min-w-0">
                        <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="songStatusDot(song.status)" />
                        <span class="truncate" style="color:var(--text-primary)">{{ song.songName }}</span>
                        <span class="text-muted-deep truncate">{{ song.artist }}</span>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div class="md:hidden sync-mobile-list">
        <article
          v-for="(s, idx) in filteredSources"
          :key="s.id"
          :draggable="canDragReorder ? 'true' : 'false'"
          class="sync-mobile-card"
          :class="[
            dragOverIdx === idx ? 'sync-mobile-card--drag-over' : '',
            dragIdx === idx ? 'opacity-50' : '',
          ]"
          @dragstart="onFilteredDragStart(idx, $event)"
          @dragover.prevent="onFilteredDragOver(idx)"
          @dragleave="onDragLeave"
          @drop="onFilteredDrop(idx)"
          @dragend="onDragEnd"
        >
          <div class="sync-mobile-card__header">
            <div class="sync-mobile-card__title-block">
              <div class="sync-mobile-card__title-row">
                <input
                  type="checkbox"
                  class="sync-source-checkbox"
                  :checked="selectedSourceIds.has(s.id)"
                  :aria-label="`选择 ${sourceDisplayName(s)}`"
                  @change="toggleSourceSelection(s.id)"
                  @click.stop
                >
                <div class="sync-mobile-card__cover">
                  <img v-if="s.coverUrl" :src="sourceCoverSrc(s.coverUrl)" :alt="`${sourceDisplayName(s)} 封面`">
                  <div v-else class="sync-mobile-card__cover-fallback">
                    <AppIcon :name="s.type === 'album' ? 'album' : 'music'" :size="15" />
                  </div>
                </div>
                <span v-if="canDragReorder" class="sync-drag-handle" aria-hidden="true">
                  <AppIcon name="grip" :size="15" />
                </span>
                <SourceBadge :type="s.type" :subscribed="s.subscribed" />
                <span class="sync-mobile-card__title">{{ sourceDisplayName(s) }}</span>
              </div>
              <p class="sync-mobile-card__subtitle">{{ sourceOriginName(s) }}</p>
            </div>
            <button
              v-if="s.type === 'playlist'"
              class="sync-toggle"
              :class="s.enabled ? 'sync-toggle--active' : ''"
              :title="s.enabled ? '已启用，点击禁用' : '已禁用，点击启用'"
              :aria-label="s.enabled ? '禁用同步源' : '启用同步源'"
              :disabled="togglingId === s.id"
              @click="toggleEnabled(s)"
            >
              <span class="sync-toggle__thumb" :class="s.enabled ? 'sync-toggle__thumb--active' : ''" />
            </button>
          </div>

          <div class="sync-mobile-card__stats">
            <div>
              <span class="sync-mobile-card__stat-label">Plex</span>
              <span class="sync-mobile-card__stat-value">{{ plexTargetName(s) }}</span>
            </div>
            <div>
              <span class="sync-mobile-card__stat-label">歌曲数</span>
              <span class="sync-mobile-card__stat-value">{{ s.trackCount }} 首</span>
            </div>
            <div>
              <span class="sync-mobile-card__stat-label">忽略</span>
              <button
                class="sync-mobile-card__issue"
                :disabled="sourceIssueCount(s) === 0"
                @click.stop="sourceIssueCount(s) > 0 && clearIgnored(s)"
              >
                {{ sourceIssueCount(s) }} 首
              </button>
            </div>
          </div>

          <div class="sync-mobile-card__status-row">
            <span class="sync-pill" :class="sourceStateClass(s)">{{ sourceStateLabel(s) }}</span>
            <span class="sync-mobile-card__result">
              <span class="sync-result-dot" :class="syncResultDotClass(s)" />
              <span class="sync-table__result-label" :class="syncResultTextClass(s)">{{ repairingSourceId === s.id ? '补全中' : syncResultLabel(s) }}</span>
            </span>
            <span class="text-2xs text-muted-deep">{{ s.lastSyncedAt ? formatRelative(s.lastSyncedAt) : '未同步' }}</span>
          </div>

          <div class="sync-mobile-card__actions">
            <button
              class="btn btn-secondary btn-xs grow"
              :disabled="isAnySyncing || (s.type === 'playlist' && !s.enabled)"
              @click="s.type === 'playlist' ? syncSource(s) : syncSource(s, true)"
            >
              <AppIcon
                :name="s.type === 'playlist' ? 'sync' : 'download'"
                :size="14"
                :class="(syncingSourceId === s.id || forceFullId === s.id) ? 'animate-spin' : ''"
              />
              {{ s.type === 'playlist' ? '同步' : '下载' }}
            </button>
            <button class="icon-button" type="button" aria-label="展开歌曲明细" @click="toggleExpand(s.id)">
              <AppIcon name="chevronRight" :size="14" class="transition-transform" :class="expandedId === s.id ? 'rotate-90' : ''" />
            </button>
            <button class="icon-button" type="button" aria-label="编辑同步源" @click="openEdit(s)">
              <AppIcon name="edit" :size="14" />
            </button>
            <div class="sync-row-actions__menu">
              <button class="icon-button" type="button" aria-label="更多操作" @click.stop="toggleMoreMenu(s.id)">
                <AppIcon name="more" :size="14" />
              </button>
              <div v-if="moreMenuId === s.id" class="sync-row-menu sync-row-menu--top" @click.stop>
                <button
                  v-if="s.type === 'playlist'"
                  class="sync-row-menu__item"
                  :disabled="isAnySyncing"
                  @click="syncSource(s, true); moreMenuId = null"
                >
                  <AppIcon name="refresh" :size="12" />
                  <span>全量同步</span>
                </button>
                <button class="sync-row-menu__item" :disabled="isAnySyncing" @click="openRebuildConfirm(s); moreMenuId = null">
                  <AppIcon name="repair" :size="12" />
                  <span>{{ rebuildActionLabel(s) }}</span>
                </button>
                <button
                  class="sync-row-menu__item"
                  :class="repairingSourceId === s.id ? 'sync-row-menu__item--active' : ''"
                  :disabled="isAnySyncing"
                  @click="repairSource(s); moreMenuId = null"
                >
                  <span v-if="repairingSourceId === s.id && repairProgress[s.id]">{{ repairProgress[s.id].processed }}/{{ repairProgress[s.id].total }}</span>
                  <AppIcon v-else name="music" :size="12" />
                  <span>补词/图</span>
                </button>
                <button class="sync-row-menu__item sync-row-menu__item--danger" type="button" @click="confirmDelete = s; moreMenuId = null">
                  <AppIcon name="trash" :size="12" />
                  <span>删除</span>
                </button>
              </div>
              <div v-if="moreMenuId === s.id" class="fixed inset-0 z-10" @click="moreMenuId = null" />
            </div>
          </div>

          <div v-if="expandedId === s.id" class="sync-expanded-panel sync-expanded-panel--mobile">
            <div v-if="expandedLoading" class="text-2xs text-muted py-2">加载中...</div>
            <div v-else-if="expandedSongs.length === 0" class="text-2xs text-muted py-2">暂无歌曲记录</div>
            <div v-else class="grid grid-cols-1 gap-y-2">
              <div v-for="song in expandedSongs" :key="song.id" class="flex items-center gap-2 text-xs min-w-0">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="songStatusDot(song.status)" />
                <span class="truncate" style="color:var(--text-primary)">{{ song.songName }}</span>
                <span class="text-muted-deep truncate">{{ song.artist }}</span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <div
      v-if="hoverCard"
      class="sync-hover-card"
      :style="{ top: `${hoverCard.top}px`, left: `${hoverCard.left}px` }"
      role="tooltip"
      aria-live="polite"
    >
      <div class="sync-hover-card__header">
        <div class="sync-hover-card__cover">
          <img
            v-if="hoverCard.source.coverUrl"
            :src="sourceCoverSrc(hoverCard.source.coverUrl)"
            :alt="`${sourceDisplayName(hoverCard.source)} 封面`"
          >
          <div v-else class="sync-hover-card__cover-fallback">
            <AppIcon :name="hoverCard.source.type === 'album' ? 'album' : 'music'" :size="22" />
          </div>
        </div>
        <div class="min-w-0">
          <div class="sync-hover-card__title-row">
            <span class="sync-hover-card__title">{{ sourceDisplayName(hoverCard.source) }}</span>
            <SourceBadge :type="hoverCard.source.type" :subscribed="hoverCard.source.subscribed" />
          </div>
          <p v-if="sourceHoverOrigin(hoverCard.source)" class="sync-hover-card__origin">{{ sourceHoverOrigin(hoverCard.source) }}</p>
          <p class="sync-hover-card__meta">ID {{ hoverCard.source.neteasePlaylistId }} · Plex {{ plexTargetName(hoverCard.source) }}</p>
        </div>
      </div>
      <div class="sync-hover-card__stats">
        <span>{{ hoverCard.source.trackCount }} 首</span>
        <span>{{ sourceIssueCount(hoverCard.source) > 0 ? sourceIssueSummary(hoverCard.source) : '无忽略' }}</span>
        <span>{{ repairingSourceId === hoverCard.source.id ? '补全中' : syncResultLabel(hoverCard.source) }}</span>
      </div>
      <p class="sync-hover-card__footer">
        {{ hoverCard.source.lastSyncedAt
          ? `${hoverCard.source.type === 'album' ? '上次下载' : '上次同步'} ${formatRelative(hoverCard.source.lastSyncedAt)}`
          : (hoverCard.source.type === 'album' ? '尚未下载' : '尚未同步') }}
      </p>
    </div>

    <!-- Dialogs -->
    <AddPlaylistDialog
      :visible="showAdd"
      :source-ids="allSources.map(s => s.neteasePlaylistId)"
      @update:visible="showAdd = $event"
      @created="onPlaylistCreated"
      @created-album="onAlbumCreated"
    />
    <EditSourceDialog :source="editTarget" @close="editTarget = null" @saved="onSourceSaved" />
    <ConfirmDialog
      :visible="!!confirmDelete"
      title="删除同步源"
      :message="`确定要删除${confirmDelete?.type === 'album' ? '已保存专辑' : '同步源'}「${confirmDelete?.name}」吗？此操作不可撤销。`"
      confirm-label="删除"
      variant="danger"
      @confirm="handleDelete"
      @cancel="confirmDelete = null"
    />
    <ConfirmDialog
      :visible="confirmBatchDelete"
      title="删除选中的来源"
      :message="`确定要删除已选 ${selectedCount} 个来源吗？相关下载记录也会被移除，此操作不可撤销。`"
      confirm-label="删除选中"
      variant="danger"
      @confirm="handleBatchDelete"
      @cancel="confirmBatchDelete = false"
    />
    <ConfirmDialog
      :visible="!!confirmRebuild"
      :title="confirmRebuild?.type === 'album' ? '重建匹配并下载' : '重建匹配并同步'"
      :message="confirmRebuild?.type === 'album'
        ? `将清除此专辑当前下载范围内的匹配缓存，并立即执行一次重新下载对比。不会清除失败记忆。确定继续处理「${confirmRebuild?.name || ''}」吗？`
        : `将清除此同步源当前同步范围内的匹配缓存，并立即执行一次全量对比。不会清除失败记忆。确定继续处理「${confirmRebuild?.name || ''}」吗？`"
      :confirm-label="confirmRebuild?.type === 'album' ? '确认重建并下载' : '确认重建'"
      @confirm="handleRebuildSync"
      @cancel="confirmRebuild = null"
    />
  </div>
</template>

<script setup lang="ts">
import AddPlaylistDialog from '~/components/sources/AddPlaylistDialog.vue'
import EditSourceDialog from '~/components/sources/EditSourceDialog.vue'
import { useSyncSourcesPage } from '~~/composables/useSyncSourcesPage'

const {
  advancedFilterCount, advancedFilterLabel, allSources, allVisibleSelected, applyDraftFilters, batchDeleting, batchLoading, batchToggling,
  canBatchSyncSelected, canBatchToggleSelected, canDragReorder, clearIgnored, clearSourceFilters, confirmBatchDelete, confirmDelete, confirmRebuild,
  desktopActionDensity, draftEnabledFilter, draftIssueFilter, draftStatusFilter, draftSubscribedFilter, dragIdx, dragOverIdx, editTarget,
  enabledCount, expandedId, expandedLoading, expandedSongs, filteredSources, filterType, forceFullId, formatRelative,
  handleBatchDelete, handleDelete, handleRebuildSync, hoverCard, isAnySyncing, lastSyncTime, loading, moreMenuId,
  onAlbumCreated, onDragEnd, onDragLeave, onFilteredDragOver, onFilteredDragStart, onFilteredDrop, onPlaylistCreated, onSourceSaved,
  onSourceSearchInput, onSourceTabChange, openAddPlaylist, openBatchDeleteConfirm, openEdit, openRebuildConfirm, plexTargetHint, plexTargetName,
  prepareDraftFilters, rebuildActionLabel, refreshSources, removeSourceFilter, repairingSourceId, repairProgress, repairSource, resetDraftFilters,
  runSelectedBatch, scheduleHideSourceHover, selectedCount, selectedSourceIds, showAdd, showInlineEditAction, showInlineFullSyncAction, showInlineRepairAction,
  showSourceHover, someVisibleSelected, songStatusDot, sourceCanClear, sourceCopyrightCount, sourceCoverSrc, sourceDisplayName, sourceFilterChips,
  sourceHoverOrigin, sourceIgnoredCount, sourceIssueCount, sourceIssueSummary, sourceMetaLabel, sourceOriginName, sourcePageTabs, sourceSearch,
  sourceStateClass, sourceStateLabel, syncingSourceId, syncResultDotClass, syncResultLabel, syncResultTextClass, syncSource, tableShellRef,
  toggleEnabled, toggleExpand, toggleMoreMenu, toggleSelectAllVisible, toggleSourceSelection, togglingId, totalCopyright, totalIgnored,
  totalSourceCount,
} = useSyncSourcesPage()
</script>

<style scoped>
@import '~/assets/css/pages/sync-sources-layout.css';
@import '~/assets/css/pages/sync-sources-table.css';
</style>
