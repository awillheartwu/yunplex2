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
    <EditSourceDialog :source="editTarget" @close="editTarget = null" @saved="refreshSources" />
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
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import AddPlaylistDialog from '~/components/sources/AddPlaylistDialog.vue'
import EditSourceDialog from '~/components/sources/EditSourceDialog.vue'
import { useDragReorder } from '~~/composables/useDragReorder'
import {
  formatSyncSourceRelativeTime,
  getCopyrightCount,
  getIgnoredFailureCount,
  getIssueCount,
  getPlexTargetName,
  getPlexTargetHint,
  getSourceDisplayName,
  getSourceMetaLabel,
  getSourceOriginName,
  getSourceStateLabel,
  getSourceStateTone,
  getIssueSummaryLabel,
  getSyncResultLabel,
  getSyncResultTone,
} from '~~/composables/useSyncSourcePresentation'
import { countActiveFilters } from '~~/composables/useFilterQuery'
import { useDebounceFn } from '~~/composables/useTiming'
import { useFeedback } from '~~/composables/useFeedback'

const api = useApi()
const route = useRoute()
const router = useRouter()
const feedback = useFeedback()
const { syncingSourceId, syncSource: triggerSourceSync } = useSourceSync()
const { state: globalSyncState } = useSync()
const sources = ref<PlaylistSource[]>([])
const allSources = ref<PlaylistSource[]>([])
const loading = ref(false)
const togglingId = ref<string | null>(null)
const forceFullId = ref<string | null>(null)
const rebuildSyncId = ref<string | null>(null)
const repairingSourceId = ref<string | null>(null)
const repairProgress = ref<Record<string, { processed: number; total: number }>>({})

type SourceStatusFilter = '' | 'idle' | 'success' | 'partial' | 'failed'
type EnabledFilter = '' | 'enabled' | 'disabled'
type SubscribedFilter = '' | 'subscribed'
type IssueFilter = '' | 'ignored' | 'copyright'
type SourceFilterChipKey = 'search' | 'type' | 'enabled' | 'subscribed' | 'status' | 'issue'
type SourceBatchAction = 'enable' | 'disable' | 'delete' | 'sync'

const filterType = ref<'playlist' | 'album'>('playlist')
const sourceSearch = ref('')
const enabledFilter = ref<EnabledFilter>('')
const subscribedFilter = ref<SubscribedFilter>('')
const statusFilter = ref<SourceStatusFilter>('')
const issueFilter = ref<IssueFilter>('')
const draftEnabledFilter = ref<EnabledFilter>('')
const draftSubscribedFilter = ref<SubscribedFilter>('')
const draftStatusFilter = ref<SourceStatusFilter>('')
const draftIssueFilter = ref<IssueFilter>('')
const sourceFilters = [
  { key: 'playlist' as const, label: '歌单' },
  { key: 'album' as const, label: '已保存专辑' },
]
const statusFilterOptions: Array<{ value: SourceStatusFilter; label: string }> = [
  { value: '', label: '全部' },
  { value: 'success', label: '成功' },
  { value: 'partial', label: '部分失败' },
  { value: 'failed', label: '失败' },
  { value: 'idle', label: '未同步' },
]
const filteredSources = computed(() => sources.value)
const playlistSourceCount = computed(() => allSources.value.filter(s => s.type === 'playlist').length)
const albumSourceCount = computed(() => allSources.value.filter(s => s.type === 'album').length)
const sourcePageTabs = computed(() => sourceFilters.map(tab => ({
  ...tab,
  count: tab.key === 'playlist' ? playlistSourceCount.value : albumSourceCount.value,
})))
const sourceActiveCount = computed(() => countActiveFilters({
  search: sourceSearch.value,
  type: filterType.value === 'playlist' ? '' : filterType.value,
  enabled: enabledFilter.value,
  subscribed: subscribedFilter.value,
  status: statusFilter.value,
  issue: issueFilter.value,
}))
const advancedFilterCount = computed(() => countActiveFilters({
  enabled: enabledFilter.value,
  subscribed: subscribedFilter.value,
  status: statusFilter.value,
  issue: issueFilter.value,
}))
const sourceCanClear = computed(() => sourceActiveCount.value > 0)
const canDragReorder = computed(() => filterType.value === 'playlist' && sourceActiveCount.value === 0)
const selectedSourceIds = ref(new Set<string>())
const selectedSources = computed(() => {
  const ids = selectedSourceIds.value
  return filteredSources.value.filter(source => ids.has(source.id))
})
const selectedCount = computed(() => selectedSourceIds.value.size)
const selectedHasAlbum = computed(() => selectedSources.value.some(source => source.type === 'album'))
const selectedHasDisabledPlaylist = computed(() => selectedSources.value.some(source => source.type === 'playlist' && !source.enabled))
const canBatchToggleSelected = computed(() => selectedCount.value > 0 && !selectedHasAlbum.value)
const canBatchSyncSelected = computed(() =>
  selectedCount.value > 0
  && !selectedHasAlbum.value
  && !selectedHasDisabledPlaylist.value
  && !isAnySyncing.value
  && !batchLoading.value,
)
const allVisibleSelected = computed(() => filteredSources.value.length > 0 && filteredSources.value.every(source => selectedSourceIds.value.has(source.id)))
const someVisibleSelected = computed(() =>
  filteredSources.value.some(source => selectedSourceIds.value.has(source.id)) && !allVisibleSelected.value,
)
const sourceFilterChips = computed<Array<{ key: SourceFilterChipKey; label: string }>>(() => {
  const chips: Array<{ key: SourceFilterChipKey; label: string }> = []
  const search = sourceSearch.value.trim()
  if (search) chips.push({ key: 'search', label: `搜索：${search}` })
  if (filterType.value === 'album') chips.push({ key: 'type', label: '类型：已保存专辑' })
  if (enabledFilter.value) chips.push({ key: 'enabled', label: `状态：${enabledFilter.value === 'enabled' ? '已启用' : '已禁用'}` })
  if (statusFilter.value) chips.push({ key: 'status', label: `结果：${statusFilterOptions.find(option => option.value === statusFilter.value)?.label ?? statusFilter.value}` })
  if (subscribedFilter.value) chips.push({ key: 'subscribed', label: '特殊：已绑定目标' })
  if (issueFilter.value) chips.push({ key: 'issue', label: `特殊：${issueFilter.value === 'ignored' ? '有忽略' : '版权受限'}` })
  return chips
})

function queryString(key: string): string {
  const value = route.query[key]
  if (Array.isArray(value)) return value[0] ?? ''
  return typeof value === 'string' ? value : ''
}

function restoreSourceFiltersFromRoute() {
  sourceSearch.value = queryString('search')
  filterType.value = queryString('type') === 'album' ? 'album' : 'playlist'
  enabledFilter.value = ['enabled', 'disabled'].includes(queryString('enabled')) ? queryString('enabled') as EnabledFilter : ''
  subscribedFilter.value = queryString('subscribed') === 'subscribed' ? 'subscribed' : ''
  statusFilter.value = ['idle', 'success', 'partial', 'failed'].includes(queryString('status')) ? queryString('status') as SourceStatusFilter : ''
  issueFilter.value = ['ignored', 'copyright'].includes(queryString('issue')) ? queryString('issue') as IssueFilter : ''
}

function syncSourceFilterQuery() {
  router.replace({
    query: {
      ...route.query,
      search: sourceSearch.value || undefined,
      type: filterType.value === 'playlist' ? undefined : filterType.value,
      enabled: enabledFilter.value || undefined,
      subscribed: subscribedFilter.value || undefined,
      status: statusFilter.value || undefined,
      issue: issueFilter.value || undefined,
    },
  })
}

function buildSourceParams(): Record<string, string> {
  const params: Record<string, string> = { type: filterType.value }
  const search = sourceSearch.value.trim()
  if (search) params.search = search
  if (enabledFilter.value) params.enabled = enabledFilter.value === 'enabled' ? '1' : '0'
  if (subscribedFilter.value === 'subscribed') params.subscribed = '1'
  if (statusFilter.value) params.lastStatus = statusFilter.value
  if (issueFilter.value === 'ignored') params.hasIgnored = '1'
  if (issueFilter.value === 'copyright') params.hasCopyright = '1'
  return params
}

async function applySourceFilters() {
  syncSourceFilterQuery()
  await fetchSources()
}

const sourceSearchDebounce = useDebounceFn(() => { void applySourceFilters() }, 400)
function onSourceSearchInput(value: string) {
  sourceSearch.value = value
  syncSourceFilterQuery()
  sourceSearchDebounce.run()
}

function setSourceType(type: 'playlist' | 'album') {
  filterType.value = type
  void applySourceFilters()
}

function onSourceTabChange(type: string) {
  if (type === 'playlist' || type === 'album') setSourceType(type)
}

function prepareDraftFilters() {
  draftEnabledFilter.value = enabledFilter.value
  draftSubscribedFilter.value = subscribedFilter.value
  draftStatusFilter.value = statusFilter.value
  draftIssueFilter.value = issueFilter.value
}

function resetDraftFilters() {
  draftEnabledFilter.value = ''
  draftSubscribedFilter.value = ''
  draftStatusFilter.value = ''
  draftIssueFilter.value = ''
}

function applyDraftFilters(close?: () => void) {
  enabledFilter.value = draftEnabledFilter.value
  subscribedFilter.value = draftSubscribedFilter.value
  statusFilter.value = draftStatusFilter.value
  issueFilter.value = draftIssueFilter.value
  close?.()
  void applySourceFilters()
}

function clearSourceFilters() {
  sourceSearch.value = ''
  filterType.value = 'playlist'
  enabledFilter.value = ''
  subscribedFilter.value = ''
  statusFilter.value = ''
  issueFilter.value = ''
  resetDraftFilters()
  void applySourceFilters()
}

function removeSourceFilter(key: SourceFilterChipKey) {
  if (key === 'search') sourceSearch.value = ''
  if (key === 'type') filterType.value = 'playlist'
  if (key === 'enabled') enabledFilter.value = ''
  if (key === 'subscribed') subscribedFilter.value = ''
  if (key === 'status') statusFilter.value = ''
  if (key === 'issue') issueFilter.value = ''
  void applySourceFilters()
}

async function refreshSources() {
  await fetchSources()
  await fetchSummarySources()
}

// Summary computed
const totalSourceCount = computed(() => allSources.value.length)
const enabledCount = computed(() => allSources.value.filter(s => s.type === 'playlist' && s.enabled).length)
const lastSyncTime = computed(() => {
  const times = allSources.value.filter(s => s.lastSyncedAt).map(s => new Date(s.lastSyncedAt!).getTime())
  if (times.length === 0) return ''
  const latest = new Date(Math.max(...times))
  return formatRelative(latest.toISOString())
})
const totalIgnored = computed(() => allSources.value.reduce((sum, s) => sum + sourceIgnoredCount(s), 0))
const totalCopyright = computed(() => allSources.value.reduce((sum, s) => sum + sourceCopyrightCount(s), 0))
const advancedFilterLabel = computed(() => advancedFilterCount.value > 0 ? '筛选' : '高级筛选')

// Add dialogs
const showAdd = ref(false)
// Edit
const editTarget = ref<PlaylistSource | null>(null)
const hoverCard = ref<{ source: PlaylistSource; top: number; left: number } | null>(null)
const tableShellRef = ref<HTMLElement | null>(null)
const tableShellWidth = ref(0)
let hoverHideTimer: ReturnType<typeof setTimeout> | null = null
let tableShellResizeObserver: ResizeObserver | null = null

// Drag & drop — only enabled in 歌单 view; wrapper handlers map filtered indices to sources indices
const { dragIdx, dragOverIdx, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = useDragReorder(
  sources,
  async (orderedIds) => { await api.put('/playlist-sources/reorder', { orderedIds }) },
  (s) => s.id,
)

// Wrap drag handlers to work with filteredSources indices → sources indices
function onFilteredDragStart(idx: number, e: DragEvent) {
  if (!canDragReorder.value) return
  const item = filteredSources.value[idx]
  if (!item) return
  const realIdx = sources.value.findIndex(s => s.id === item!.id)
  if (realIdx >= 0) onDragStart(realIdx, e)
}
function onFilteredDragOver(idx: number) {
  if (!canDragReorder.value) return
  const item = filteredSources.value[idx]
  if (!item) return
  const realIdx = sources.value.findIndex(s => s.id === item!.id)
  if (realIdx >= 0) onDragOver(realIdx)
}
function onFilteredDrop(idx: number) {
  if (!canDragReorder.value) return
  const item = filteredSources.value[idx]
  if (!item) return
  const realIdx = sources.value.findIndex(s => s.id === item!.id)
  if (realIdx >= 0) onDrop(realIdx)
}

function pruneSelectionToVisible() {
  const visibleIds = new Set(filteredSources.value.map(source => source.id))
  const next = new Set([...selectedSourceIds.value].filter(id => visibleIds.has(id)))
  if (next.size !== selectedSourceIds.value.size) selectedSourceIds.value = next
}

function toggleSourceSelection(id: string) {
  const next = new Set(selectedSourceIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedSourceIds.value = next
}

function toggleSelectAllVisible() {
  const next = new Set(selectedSourceIds.value)
  if (allVisibleSelected.value) {
    for (const source of filteredSources.value) next.delete(source.id)
  } else {
    for (const source of filteredSources.value) next.add(source.id)
  }
  selectedSourceIds.value = next
}

function clearSelection() {
  selectedSourceIds.value = new Set()
}

const confirmDelete = ref<PlaylistSource | null>(null)
const confirmRebuild = ref<PlaylistSource | null>(null)
const confirmBatchDelete = ref(false)

function openAddPlaylist() { showAdd.value = true }
function onPlaylistCreated() {
  filterType.value = 'playlist'
  void refreshSources()
}
function onAlbumCreated() {
  filterType.value = 'album'
  void refreshSources()
}
function openEdit(s: PlaylistSource) { editTarget.value = s }

// More menu
const moreMenuId = ref<string | null>(null)
function toggleMoreMenu(id: string) {
  moreMenuId.value = moreMenuId.value === id ? null : id
}

type DesktopActionDensity = 'compact' | 'comfortable' | 'wide' | 'expanded'

const desktopActionDensity = computed<DesktopActionDensity>(() => {
  const width = tableShellWidth.value || 0
  if (width >= 1780) return 'expanded'
  if (width >= 1540) return 'wide'
  if (width >= 1320) return 'comfortable'
  return 'compact'
})

const showInlineEditAction = computed(() =>
  desktopActionDensity.value === 'comfortable'
  || desktopActionDensity.value === 'wide'
  || desktopActionDensity.value === 'expanded',
)

const showInlineRepairAction = computed(() =>
  desktopActionDensity.value === 'wide'
  || desktopActionDensity.value === 'expanded',
)

function showInlineFullSyncAction(source: PlaylistSource): boolean {
  return source.type === 'playlist' && desktopActionDensity.value === 'expanded'
}

function updateTableShellWidth() {
  tableShellWidth.value = tableShellRef.value?.clientWidth ?? window.innerWidth
}

// Expand songs
const expandedId = ref<string | null>(null)
const expandedSongs = ref<Array<{ id: string; songName: string; artist: string; status: string }>>([])
const expandedLoading = ref(false)

async function toggleExpand(sourceId: string) {
  if (expandedId.value === sourceId) { expandedId.value = null; return }
  expandedId.value = sourceId
  expandedLoading.value = true
  try { expandedSongs.value = await api.get(`/playlist-sources/${sourceId}/songs`) } catch { expandedSongs.value = [] }
  finally { expandedLoading.value = false }
}

function songStatusDot(status: string): string {
  switch (status) {
    case 'success': return 'bg-success'
    case 'failed_download': case 'failed_tags': return 'bg-danger'
    case 'failed_plex_match': case 'failed_plex_insert': return 'bg-warning'
    case 'copyright_restricted': case 'ignored_failure': return 'bg-ignored'
    case 'skipped_existing': return 'bg-existing'
    default: return 'bg-muted-deep'
  }
}

function sourceDisplayName(source: PlaylistSource): string {
  return getSourceDisplayName(source)
}

function sourceOriginName(source: PlaylistSource): string {
  return getSourceOriginName(source)
}

function sourceMetaLabel(source: PlaylistSource): string {
  return getSourceMetaLabel(source)
}

function plexTargetName(source: PlaylistSource): string {
  return getPlexTargetName(source)
}

function plexTargetHint(source: PlaylistSource): string {
  return getPlexTargetHint(source)
}

function sourceCoverSrc(url: string): string {
  if (!url) return ''
  return url.includes('?') ? `${url}&param=80y80` : `${url}?param=80y80`
}

function sourceIgnoredCount(source: PlaylistSource): number {
  return getIgnoredFailureCount(source)
}

function sourceCopyrightCount(source: PlaylistSource): number {
  return getCopyrightCount(source)
}

function sourceIssueCount(source: PlaylistSource): number {
  return getIssueCount(source)
}

function sourceIssueSummary(source: PlaylistSource): string {
  return getIssueSummaryLabel(source)
}

function sourceHoverOrigin(source: PlaylistSource): string {
  const origin = sourceOriginName(source)
  return origin !== sourceDisplayName(source) ? origin : ''
}

function sourceStateLabel(source: PlaylistSource): string {
  return getSourceStateLabel(source)
}

function sourceStateClass(source: PlaylistSource): string {
  const tone = getSourceStateTone(source)
  return `sync-pill--${tone}`
}

function syncResultLabel(source: PlaylistSource): string {
  return getSyncResultLabel(source)
}

function rebuildActionLabel(source: PlaylistSource): string {
  return source.type === 'album' ? '重建匹配并下载' : '重建匹配并同步'
}

function syncResultTextClass(source: PlaylistSource): string {
  const tone = repairingSourceId.value === source.id ? 'accent' : getSyncResultTone(source)
  return `sync-table__result-label--${tone}`
}

function syncResultDotClass(source: PlaylistSource): string {
  if (repairingSourceId.value === source.id) return 'sync-result-dot--accent'
  switch (getSyncResultTone(source)) {
    case 'success':
      return 'sync-result-dot--success'
    case 'warning':
      return 'sync-result-dot--warning'
    case 'danger':
      return 'sync-result-dot--danger'
    default:
      return 'sync-result-dot--neutral'
  }
}

function clearHoverHideTimer() {
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer)
    hoverHideTimer = null
  }
}

function showSourceHover(source: PlaylistSource, event: MouseEvent | FocusEvent) {
  clearHoverHideTimer()
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  const width = 22 * 16
  const height = 12.5 * 16
  const gutter = 16
  let left = rect.left
  let top = rect.bottom + 12

  if (left + width > window.innerWidth - gutter) {
    left = Math.max(gutter, window.innerWidth - width - gutter)
  }

  if (top + height > window.innerHeight - gutter) {
    top = Math.max(gutter, rect.top - height - 12)
  }

  hoverCard.value = { source, top, left }
}

function scheduleHideSourceHover() {
  clearHoverHideTimer()
  hoverHideTimer = setTimeout(() => {
    hoverCard.value = null
  }, 90)
}

async function clearIgnored(s: PlaylistSource) {
  try {
    await api.put(`/playlist-sources/${s.id}`, { ignoredFailureIds: null, copyrightRestrictedIds: null })
    await refreshSources()
    feedback.success('忽略记录已清除')
  } catch { /* ignore */ }
}

async function fetchSummarySources() {
  try {
    allSources.value = await api.get<PlaylistSource[]>('/playlist-sources')
  } catch { /* keep previous summary */ }
}

async function fetchSources() {
  loading.value = true
  try {
    sources.value = await api.get<PlaylistSource[]>('/playlist-sources', buildSourceParams())
    pruneSelectionToVisible()
  } catch { /* ignore */ }
  finally { loading.value = false }
}

async function toggleEnabled(s: PlaylistSource) {
  togglingId.value = s.id
  const prev = s.enabled
  const next = !prev
  s.enabled = next
  try {
    await api.put(`/playlist-sources/${s.id}`, { enabled: next })
    await fetchSummarySources()
  } catch {
    s.enabled = prev
  } finally {
    togglingId.value = null
  }
}

async function handleDelete() {
  if (!confirmDelete.value) return
  const id = confirmDelete.value.id; confirmDelete.value = null
  try {
    await api.del(`/playlist-sources/${id}`)
    await refreshSources()
    feedback.success('同步源已删除')
  } catch {
    feedback.error('删除同步源失败')
  }
}

const isAnySyncing = computed(() =>
  syncingSourceId.value !== null
  || forceFullId.value !== null
  || rebuildSyncId.value !== null
  || repairingSourceId.value !== null,
)

function openRebuildConfirm(source: PlaylistSource) {
  confirmRebuild.value = source
}

async function syncSource(s: PlaylistSource, forceFull = false) {
  try {
    if (forceFull) {
      if (s.type === 'album') syncingSourceId.value = s.id
      else forceFullId.value = s.id
      await api.post(`/playlist-sources/${s.id}/sync`, { forceFull: true })
    } else {
      await triggerSourceSync(s.id)
    }
  } catch {
    forceFullId.value = null
    syncingSourceId.value = null
  }
}

async function handleRebuildSync() {
  if (!confirmRebuild.value) return
  const source = confirmRebuild.value
  confirmRebuild.value = null
  rebuildSyncId.value = source.id
  try {
    await api.post(`/playlist-sources/${source.id}/sync`, { forceFull: true, rebuildMatch: true })
  } catch {
    rebuildSyncId.value = null
  }
}

const batchLoading = ref(false)
const batchToggling = ref(false)
const batchDeleting = ref(false)

async function runSelectedBatch(action: Exclude<SourceBatchAction, 'delete'>) {
  const ids = [...selectedSourceIds.value]
  if (ids.length === 0) return
  if (action === 'sync') batchLoading.value = true
  else batchToggling.value = true
  try {
    const result = await api.post<{ count: number; action: SourceBatchAction }>('/playlist-sources/batch', { action, ids })
    if (action !== 'sync') {
      feedback.success(action === 'enable' ? `已启用 ${result.count} 个同步源` : `已禁用 ${result.count} 个同步源`)
      clearSelection()
      await refreshSources()
    } else {
      feedback.success(`已触发 ${result.count} 个同步源同步`)
    }
  } catch {
    if (action === 'sync') batchLoading.value = false
    feedback.error('批量操作失败')
  } finally {
    if (action !== 'sync') batchToggling.value = false
  }
}

// Track global sync via composable for batch button loading state
watch(() => globalSyncState.value?.isRunning, (running) => {
  if (!running && batchLoading.value) {
    batchLoading.value = false
    feedback.success('批量同步已完成')
    clearSelection()
  }
})

function openBatchDeleteConfirm() {
  if (selectedCount.value === 0) return
  confirmBatchDelete.value = true
}

async function handleBatchDelete() {
  const ids = [...selectedSourceIds.value]
  if (ids.length === 0) return
  confirmBatchDelete.value = false
  batchDeleting.value = true
  try {
    const result = await api.post<{ count: number }>('/playlist-sources/batch', { action: 'delete', ids })
    feedback.success(`已删除 ${result.count} 个来源`)
    clearSelection()
    await refreshSources()
  } catch {
    feedback.error('批量删除失败')
  } finally {
    batchDeleting.value = false
  }
}

async function repairSource(s: PlaylistSource) {
  if (repairingSourceId.value) return
  repairingSourceId.value = s.id
  try {
    await api.post(`/playlist-sources/${s.id}/repair`)
  } catch {
    repairingSourceId.value = null
  }
}

// SSE: clear spinners when sync finishes
const sseUnsubs: Array<() => void> = []

onMounted(() => {
  restoreSourceFiltersFromRoute()
  void refreshSources()
  updateTableShellWidth()

  const hideHover = () => { hoverCard.value = null }
  window.addEventListener('scroll', hideHover, true)
  window.addEventListener('resize', hideHover)
  window.addEventListener('resize', updateTableShellWidth)

  if (typeof ResizeObserver !== 'undefined' && tableShellRef.value) {
    tableShellResizeObserver = new ResizeObserver(() => updateTableShellWidth())
    tableShellResizeObserver.observe(tableShellRef.value)
  }

  sseUnsubs.push(sseSubscribe('stage-change', (data) => {
    const stage = data.stage as string
    if (stage === 'idle') {
      forceFullId.value = null
      rebuildSyncId.value = null
      repairingSourceId.value = null
      repairProgress.value = {}
      void refreshSources()
    }
  }))
  sseUnsubs.push(sseSubscribe('repair-progress', (data) => {
    const { sourceId, processed, totalSongs } = data as Record<string, unknown>
    if (sourceId && typeof processed === 'number') {
      repairProgress.value = { ...repairProgress.value, [sourceId as string]: { processed, total: totalSongs as number } }
    }
  }))
  sseUnsubs.push(() => window.removeEventListener('scroll', hideHover, true))
  sseUnsubs.push(() => window.removeEventListener('resize', hideHover))
  sseUnsubs.push(() => window.removeEventListener('resize', updateTableShellWidth))
})

onUnmounted(() => {
  clearHoverHideTimer()
  tableShellResizeObserver?.disconnect()
  for (const unsub of sseUnsubs) unsub()
})

function formatRelative(iso: string): string {
  return formatSyncSourceRelativeTime(iso)
}

</script>

<style scoped>
.sync-sources-page__toolbar-button {
  box-shadow: var(--shadow-xs);
}

.sync-summary-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.85rem;
  padding: 1rem 1.1rem;
  min-height: 5.75rem;
}

.sync-summary-card__icon {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-primary);
}

.sync-summary-card__icon--primary {
  color: var(--accent);
  background: var(--accent-muted);
}

.sync-summary-card__icon--muted {
  color: var(--text-secondary);
  background: rgba(137, 146, 165, 0.08);
}

.sync-summary-card__icon--ignored {
  color: var(--ignored);
  background: var(--ignored-soft);
}

.sync-summary-card__label {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-tertiary);
}

.sync-summary-card__value {
  margin: 0;
  font-size: 1.9rem;
  line-height: 1;
  font-weight: 700;
  color: var(--text-primary);
}

.sync-summary-card__value--status {
  font-size: 1.2rem;
}

.sync-batch-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0.85rem;
}

.sync-batch-bar__summary {
  min-width: 0;
}

.sync-batch-bar__count {
  font-size: 0.84rem;
  font-weight: 750;
  color: var(--text-primary);
}

.sync-batch-bar__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.45rem;
}

.sync-sources-page__list-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem 1rem;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.sync-table-shell {
  overflow: hidden;
}

.sync-table {
  --source-col-width: 20%;
  --plex-col-width: 16%;
  --track-col-width: 8%;
  --issue-col-width: 8%;
  --sync-col-width: 14%;
  --actions-col-width: 14rem;
  width: 100%;
  min-width: 78rem;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}

.sync-table--compact {
  --source-col-width: 23%;
  --plex-col-width: 17%;
  --track-col-width: 8%;
  --issue-col-width: 8%;
  --sync-col-width: 14%;
  --actions-col-width: 9.75rem;
}

.sync-table--comfortable {
  --source-col-width: 21%;
  --plex-col-width: 16%;
  --track-col-width: 8%;
  --issue-col-width: 8%;
  --sync-col-width: 14%;
  --actions-col-width: 12.5rem;
}

.sync-table--wide {
  --source-col-width: 19%;
  --plex-col-width: 15.5%;
  --track-col-width: 8%;
  --issue-col-width: 8%;
  --sync-col-width: 14%;
  --actions-col-width: 15.5rem;
}

.sync-table--expanded {
  --source-col-width: 17%;
  --plex-col-width: 15%;
  --track-col-width: 8%;
  --issue-col-width: 8%;
  --sync-col-width: 13%;
  --actions-col-width: 18.5rem;
}

.sync-table--album {
  --source-col-width: 24%;
  --plex-col-width: 18%;
}

.sync-table thead th {
  padding: 0.95rem 1rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-primary);
  background: rgba(255, 255, 255, 0.34);
}

.sync-table tbody td {
  padding: 0.95rem 1rem;
  vertical-align: middle;
  border-top: 1px solid rgba(49, 73, 113, 0.1);
}

.sync-table tbody tr:first-child td {
  border-top: 0;
}

.sync-table__row {
  transition: background 150ms ease;
}

.sync-table__row:hover {
  background: rgba(52, 87, 213, 0.035);
}

.sync-table__row--drag-over td {
  border-top-color: var(--accent);
  box-shadow: inset 0 2px 0 var(--accent);
}

.sync-table__row--expanded {
  background: rgba(255, 255, 255, 0.18);
}

.sync-table__control-col {
  width: 9rem;
}

.sync-table--album .sync-table__control-col {
  width: 6rem;
}

.sync-table__control-col--album {
  padding-left: 1rem !important;
  padding-right: 1rem !important;
}

.sync-table--album .sync-table__controls {
  justify-content: flex-start;
  gap: 0.55rem;
  min-height: 2.25rem;
}

.sync-table__actions-col {
  width: var(--actions-col-width);
  text-align: left;
}

.sync-table__controls {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.55rem;
}

.sync-table__header-controls {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.5rem;
  min-height: 1.5rem;
  white-space: nowrap;
}

.sync-table__header-controls span {
  white-space: nowrap;
}

.sync-source-checkbox {
  width: 1rem;
  height: 1rem;
}

.sync-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  cursor: grab;
}

.sync-toggle {
  position: relative;
  width: 2.7rem;
  min-width: 2.7rem;
  height: 1.6rem;
  border-radius: 999px;
  background: var(--border-secondary);
  transition: background 150ms ease;
}

.sync-toggle--active {
  background: var(--accent);
}

.sync-toggle__thumb {
  position: absolute;
  top: 0.2rem;
  left: 0.2rem;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(23, 33, 61, 0.2);
  transition: transform 150ms ease;
}

.sync-toggle__thumb--active {
  transform: translateX(1.1rem);
}

.sync-table__source-main {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  min-width: 0;
}

.sync-table__source-trigger {
  display: block;
  min-width: 0;
  border-radius: 1rem;
  padding: 0.3rem 0.35rem;
  margin: -0.3rem -0.35rem;
  cursor: pointer;
  transition: background 150ms ease, box-shadow 150ms ease;
}

.sync-table__source-trigger:hover,
.sync-table__source-trigger:focus-visible {
  background: rgba(52, 87, 213, 0.04);
  box-shadow: inset 0 0 0 1px rgba(52, 87, 213, 0.09);
}

.sync-table__source-title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  margin-bottom: 0.18rem;
}

.sync-table__cover,
.sync-table__cover img,
.sync-table__cover-fallback,
.sync-mobile-card__cover,
.sync-mobile-card__cover img,
.sync-mobile-card__cover-fallback {
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 0.75rem;
  flex-shrink: 0;
}

.sync-table__cover,
.sync-mobile-card__cover {
  overflow: hidden;
  background: var(--bg-input);
  border: 1px solid var(--border-primary);
}

.sync-table__cover img,
.sync-mobile-card__cover img {
  display: block;
  object-fit: cover;
}

.sync-table__cover-fallback,
.sync-mobile-card__cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  background: var(--bg-input);
}

.sync-table__source-name,
.sync-table__plex-name,
.sync-mobile-card__title {
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--text-primary);
}

.sync-table__source-name {
  display: block;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-table__plex-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-table__source-meta,
.sync-table__subtle {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.sync-table__subtle--numeric {
  text-align: right;
}

.sync-table__numeric {
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--text-primary);
}

.sync-table__inline-metric {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
}

.sync-table__metric-cell {
  min-height: 2.25rem;
  min-width: 5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sync-table__metric-cell--issue {
  min-width: 5rem;
}

.sync-table__inline-metric--compact {
  justify-content: center;
  min-width: 5rem;
}

.sync-table__metric-unit {
  font-size: 0.76rem;
  color: var(--text-tertiary);
}

.sync-table__issue-link,
.sync-table__issue-static {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  min-width: 5rem;
  min-height: 2.25rem;
}

.sync-table__metric-col {
  text-align: center;
}

.sync-table__issue-link {
  color: var(--ignored);
}

.sync-table__issue-static {
  color: var(--text-tertiary);
}

.sync-table__issue-value {
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.1;
}

.sync-table__issue-value--active {
  color: var(--ignored);
}

.sync-table__issue-unit {
  font-size: 0.76rem;
  color: var(--text-tertiary);
}

.sync-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.9rem;
  padding: 0 0.7rem;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 700;
  border: 1px solid transparent;
  white-space: nowrap;
}

.sync-pill--ghost {
  border-color: var(--border-primary);
  background: rgba(255, 255, 255, 0.24);
}

.sync-pill--success {
  color: var(--success);
  background: var(--success-soft);
  border-color: rgba(22, 163, 74, 0.15);
}

.sync-pill--warning {
  color: var(--warning);
  background: var(--warning-soft);
  border-color: rgba(217, 119, 6, 0.15);
}

.sync-pill--danger {
  color: var(--danger);
  background: var(--danger-soft);
  border-color: rgba(220, 38, 38, 0.15);
}

.sync-pill--neutral {
  color: var(--text-secondary);
  background: rgba(137, 146, 165, 0.12);
  border-color: rgba(49, 73, 113, 0.12);
}

.sync-pill--accent {
  color: var(--accent);
  background: var(--accent-muted);
  border-color: rgba(52, 87, 213, 0.16);
}

.sync-table__result {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.sync-table__result-label {
  font-size: 0.84rem;
  font-weight: 650;
  white-space: nowrap;
}

.sync-table__result-label--success { color: var(--success); }
.sync-table__result-label--warning { color: var(--warning); }
.sync-table__result-label--danger { color: var(--danger); }
.sync-table__result-label--neutral { color: var(--text-secondary); }
.sync-table__result-label--accent { color: var(--accent); }

.sync-table__result-meta {
  margin: 0.28rem 0 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.sync-result-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  flex-shrink: 0;
}

.sync-result-dot--success { background: var(--success); }
.sync-result-dot--warning { background: var(--warning); }
.sync-result-dot--danger { background: var(--danger); }
.sync-result-dot--neutral { background: var(--text-tertiary); }
.sync-result-dot--accent { background: var(--accent); }

.sync-table__error {
  margin: 0.35rem 0 0;
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--danger);
}

.sync-table__time-button {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--text-secondary);
  font-size: 0.82rem;
  white-space: nowrap;
}

.sync-row-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
  flex-wrap: nowrap;
}

.sync-row-actions__primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 2.5rem;
  padding: 0 0.85rem;
  border-radius: 999px;
  border: 1px solid rgba(52, 87, 213, 0.12);
  background: rgba(52, 87, 213, 0.08);
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}

.sync-row-actions__primary:hover:not(:disabled) {
  background: rgba(52, 87, 213, 0.12);
  border-color: rgba(52, 87, 213, 0.2);
}

.sync-row-actions__primary:disabled {
  opacity: 0.55;
}

.sync-row-actions__icon,
.sync-mobile-card__actions :deep(.icon-button),
.sync-mobile-card__actions .icon-button {
  min-width: 2.5rem;
  min-height: 2.5rem;
}

.sync-row-actions__progress {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--accent);
}

.sync-table__source-col {
  width: var(--source-col-width);
}

.sync-table :is(th:nth-child(3), td:nth-child(3)) {
  width: var(--plex-col-width);
}

.sync-table :is(th:nth-child(4), td:nth-child(4)) {
  width: var(--track-col-width);
  text-align: center;
}

.sync-table :is(th:nth-child(5), td:nth-child(5)) {
  width: var(--issue-col-width);
  text-align: center;
}

.sync-table :is(th:nth-child(6), td:nth-child(6)) {
  width: var(--sync-col-width);
}

.dark .sync-table thead th {
  color: rgba(233, 241, 255, 0.82);
  background: rgba(137, 158, 196, 0.16);
  border-bottom-color: rgba(143, 166, 209, 0.22);
}

.dark .sync-table__row:hover {
  background: rgba(124, 147, 255, 0.08);
}

.dark .sync-table__source-trigger:hover,
.dark .sync-table__source-trigger:focus-visible {
  background: rgba(124, 147, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(167, 183, 255, 0.16);
}

.sync-row-actions__menu {
  position: relative;
}

.sync-row-menu {
  position: absolute;
  right: 0;
  z-index: 20;
  min-width: 11.5rem;
  padding: 0.4rem;
  border-radius: 0.9rem;
  border: 1px solid var(--border-primary);
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
}

.sync-row-menu--bottom {
  top: calc(100% + 0.4rem);
}

.sync-row-menu--top {
  bottom: calc(100% + 0.4rem);
}

.sync-row-menu__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.65rem 0.7rem;
  border-radius: 0.7rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
  transition: background 150ms ease, color 150ms ease;
}

.sync-row-menu__item:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sync-row-menu__item--active {
  color: var(--accent);
}

.sync-row-menu__item--danger {
  color: var(--danger);
}

.sync-expanded-panel {
  padding: 1rem 1.1rem 1.15rem;
  background: rgba(255, 255, 255, 0.16);
}

.sync-table__expanded-row td {
  padding: 0;
  border-top: 0;
}

.dark .sync-expanded-panel {
  background:
    linear-gradient(180deg, rgba(88, 105, 141, 0.14), rgba(60, 77, 110, 0.18)),
    rgba(18, 29, 49, 0.84);
  border-top: 1px solid rgba(143, 166, 209, 0.12);
}

.dark .sync-table__expanded-row td {
  background: rgba(10, 18, 33, 0.22);
}

.sync-mobile-card {
  padding: 1rem;
  border-top: 1px solid rgba(49, 73, 113, 0.1);
  display: grid;
  gap: 0.9rem;
}

.sync-mobile-card:first-child {
  border-top: 0;
}

.sync-mobile-card--drag-over {
  box-shadow: inset 0 2px 0 var(--accent);
}

.sync-mobile-card__header,
.sync-mobile-card__title-row,
.sync-mobile-card__status-row,
.sync-mobile-card__actions {
  display: flex;
  align-items: center;
}

.sync-mobile-card__header {
  justify-content: space-between;
  gap: 0.75rem;
}

.sync-mobile-card__title-block {
  min-width: 0;
}

.sync-mobile-card__title-row {
  gap: 0.45rem;
  min-width: 0;
}

.sync-mobile-card__title,
.sync-mobile-card__subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sync-mobile-card__subtitle {
  margin: 0.28rem 0 0;
  font-size: 0.78rem;
  color: var(--text-tertiary);
}

.sync-mobile-card__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.sync-mobile-card__stat-label {
  display: block;
  font-size: 0.72rem;
  color: var(--text-tertiary);
  margin-bottom: 0.22rem;
}

.sync-mobile-card__stat-value,
.sync-mobile-card__issue {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  font-size: 0.84rem;
  color: var(--text-primary);
}

.sync-mobile-card__issue:disabled {
  color: var(--text-secondary);
}

.sync-mobile-card__status-row {
  flex-wrap: wrap;
  gap: 0.45rem;
}

.sync-mobile-card__result {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.sync-mobile-card__actions {
  gap: 0.45rem;
}

.sync-expanded-panel--mobile {
  margin-top: -0.15rem;
  padding: 0.1rem 0 0;
  background: transparent;
}

.sync-hover-card {
  position: fixed;
  z-index: 60;
  width: 22rem;
  padding: 1rem;
  border-radius: 1.35rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(20, 22, 28, 0.96);
  box-shadow: 0 22px 50px rgba(8, 10, 18, 0.34);
  color: rgba(255, 255, 255, 0.92);
  pointer-events: none;
  backdrop-filter: blur(18px);
}

.sync-hover-card__header {
  display: flex;
  gap: 0.9rem;
  min-width: 0;
}

.sync-hover-card__cover,
.sync-hover-card__cover img,
.sync-hover-card__cover-fallback {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 1rem;
  flex-shrink: 0;
}

.sync-hover-card__cover {
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.sync-hover-card__cover img {
  display: block;
  object-fit: cover;
}

.sync-hover-card__cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.64);
  background: rgba(255, 255, 255, 0.08);
}

.sync-hover-card__title-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.sync-hover-card__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.15rem;
  font-weight: 700;
  color: #fff;
}

.sync-hover-card__origin,
.sync-hover-card__meta,
.sync-hover-card__footer {
  margin: 0.3rem 0 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.68);
}

.sync-hover-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.75rem;
  margin-top: 0.9rem;
  font-size: 0.84rem;
  color: rgba(255, 255, 255, 0.84);
}

@media (max-width: 767px) {
  .sync-mobile-list {
    display: grid;
  }

  .sync-batch-bar {
    bottom: 0.75rem;
    top: auto;
    align-items: stretch;
    flex-direction: column;
    padding: 0.85rem;
  }

  .sync-batch-bar__actions {
    justify-content: stretch;
  }

  .sync-batch-bar__actions > .btn {
    flex: 1 1 auto;
  }

  .sync-summary-card {
    min-height: 5.25rem;
    padding: 0.9rem 1rem;
  }

  .sync-summary-card__value {
    font-size: 1.5rem;
  }

  .sync-summary-card__value--status {
    font-size: 1rem;
  }
}
</style>
