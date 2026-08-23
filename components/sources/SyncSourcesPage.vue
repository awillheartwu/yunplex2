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
      <article
        class="section-card sync-summary-card"
        :aria-label="`待处理异常：${totalActionableFailures} 个`"
      >
        <div class="sync-summary-card__icon sync-summary-card__icon--ignored">
          <AppIcon name="warn" :size="18" />
        </div>
        <div>
          <p class="sync-summary-card__label">待处理异常</p>
          <p class="sync-summary-card__value" :class="totalActionableFailures > 0 ? 'text-ignored' : 'text-muted-deep'">{{ totalActionableFailures }}</p>
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
            <FilterChip :active="draftIssueFilter === 'failures'" @click="draftIssueFilter = draftIssueFilter === 'failures' ? '' : 'failures'">有待处理异常</FilterChip>
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
              <th class="text-right" scope="col">待处理 / 版权</th>
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
                      type="button"
                      :title="sourceIssueActionLabel(s)"
                      :aria-label="sourceIssueActionLabel(s)"
                      @click.stop="retrySourceIssues(s)"
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
                      {{ repairingSourceId === s.id ? '修复中' : syncResultLabel(s) }}
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
                      aria-label="修复标签、歌词和封面"
                      title="修复标签、歌词和封面"
                      :disabled="isAnySyncing"
                      @click="repairSource(s)"
                    >
                      <span v-if="repairingSourceId === s.id && repairProgress[s.id]" class="sync-row-actions__progress">
                        {{ repairProgress[s.id]?.processed }}/{{ repairProgress[s.id]?.total }}
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
                    <SourceOverflowActions
                      :source="s"
                      :open="moreMenuId === s.id"
                      :placement="idx >= filteredSources.length - 3 ? 'top' : 'bottom'"
                      :busy="isAnySyncing"
                      :expanded="expandedId === s.id"
                      :repairing="repairingSourceId === s.id"
                      :repair-progress="repairProgress[s.id]"
                      :include-edit="!showInlineEditAction"
                      :include-full-sync="!showInlineFullSyncAction(s)"
                      include-song-details
                      :include-repair="!showInlineRepairAction"
                      @toggle="toggleMoreMenu(s.id)"
                      @close="moreMenuId = null"
                      @edit="openEdit(s); moreMenuId = null"
                      @full-sync="syncSource(s, true); moreMenuId = null"
                      @rebuild="openRebuildConfirm(s); moreMenuId = null"
                      @redownload="openRedownloadConfirm(s); moreMenuId = null"
                      @toggle-songs="toggleExpand(s.id); moreMenuId = null"
                      @repair="repairSource(s); moreMenuId = null"
                      @delete="confirmDelete = s; moreMenuId = null"
                    />
                  </div>
                </td>
              </tr>
              <tr v-if="expandedId === s.id" class="sync-table__expanded-row">
                <td colspan="7">
                  <div class="sync-expanded-panel">
                    <SourceSongDetails :songs="expandedSongs" :loading="expandedLoading" />
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
            expandedId === s.id ? 'sync-mobile-card--expanded' : '',
          ]"
          @dragstart="onFilteredDragStart(idx, $event)"
          @dragover.prevent="onFilteredDragOver(idx)"
          @dragleave="onDragLeave"
          @drop="onFilteredDrop(idx)"
          @dragend="onDragEnd"
        >
          <div class="sync-mobile-card__header">
            <div class="sync-mobile-card__controls">
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
            </div>
            <button
              class="sync-mobile-card__identity"
              type="button"
              :aria-label="`查看 ${sourceDisplayName(s)} 的来源详情`"
              @click="openMobileSourcePreview(s)"
            >
              <span class="sync-mobile-card__cover">
                <img v-if="s.coverUrl" :src="sourceCoverSrc(s.coverUrl)" :alt="`${sourceDisplayName(s)} 封面`">
                <span v-else class="sync-mobile-card__cover-fallback">
                  <AppIcon :name="s.type === 'album' ? 'album' : 'music'" :size="15" />
                </span>
              </span>
              <span class="sync-mobile-card__copy">
                <span class="sync-mobile-card__title-line">
                  <SourceBadge :type="s.type" :subscribed="s.subscribed" />
                  <span class="sync-mobile-card__title">{{ sourceDisplayName(s) }}</span>
                </span>
                <span class="sync-mobile-card__subtitle">{{ sourceOriginName(s) }}</span>
              </span>
              <AppIcon name="info" :size="13" class="sync-mobile-card__preview-icon" />
            </button>
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

          <div class="sync-mobile-card__status-row">
            <span class="sync-pill" :class="sourceStateClass(s)">{{ sourceStateLabel(s) }}</span>
            <span class="sync-mobile-card__result">
              <span class="sync-result-dot" :class="syncResultDotClass(s)" />
              <span class="sync-table__result-label" :class="syncResultTextClass(s)">{{ repairingSourceId === s.id ? '修复中' : syncResultLabel(s) }}</span>
            </span>
            <span class="sync-mobile-card__time">{{ s.lastSyncedAt ? formatRelative(s.lastSyncedAt) : '未同步' }}</span>
          </div>

          <div class="sync-mobile-card__stats">
            <div class="sync-mobile-card__stat sync-mobile-card__stat--target">
              <span class="sync-mobile-card__stat-label">Plex 目标</span>
              <span class="sync-mobile-card__stat-value">{{ plexTargetName(s) }}</span>
            </div>
            <div class="sync-mobile-card__stat">
              <span class="sync-mobile-card__stat-label">歌曲</span>
              <span class="sync-mobile-card__stat-value">{{ s.trackCount }} 首</span>
            </div>
            <div class="sync-mobile-card__stat">
              <span class="sync-mobile-card__stat-label">待处理 / 版权</span>
              <button
                class="sync-mobile-card__issue"
                type="button"
                :disabled="sourceIssueCount(s) === 0"
                :title="sourceIssueActionLabel(s)"
                :aria-label="sourceIssueActionLabel(s)"
                @click.stop="sourceIssueCount(s) > 0 && retrySourceIssues(s)"
              >
                {{ sourceIssueCount(s) }} 首
              </button>
            </div>
          </div>

          <div class="sync-mobile-card__actions">
            <button
              class="btn btn-primary btn-xs sync-mobile-card__primary-action"
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
            <button class="btn btn-secondary btn-xs sync-mobile-card__secondary-action" type="button" @click="toggleExpand(s.id)">
              <AppIcon name="chevronRight" :size="14" class="transition-transform" :class="expandedId === s.id ? 'rotate-90' : ''" />
              歌曲
            </button>
            <button class="btn btn-secondary btn-xs sync-mobile-card__secondary-action" type="button" @click="openEdit(s)">
              <AppIcon name="edit" :size="14" />
              编辑
            </button>
            <SourceOverflowActions
              :source="s"
              :open="moreMenuId === s.id"
              :busy="isAnySyncing"
              :repairing="repairingSourceId === s.id"
              :repair-progress="repairProgress[s.id]"
              @toggle="toggleMoreMenu(s.id)"
              @close="moreMenuId = null"
              @full-sync="syncSource(s, true); moreMenuId = null"
              @rebuild="openRebuildConfirm(s); moreMenuId = null"
              @redownload="openRedownloadConfirm(s); moreMenuId = null"
              @repair="repairSource(s); moreMenuId = null"
              @delete="confirmDelete = s; moreMenuId = null"
            />
          </div>

          <div v-if="expandedId === s.id" class="sync-expanded-panel sync-expanded-panel--mobile">
            <SourceSongDetails :songs="expandedSongs" :loading="expandedLoading" mobile />
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
      <SourceSummaryContent :source="hoverCard.source" :repairing="repairingSourceId === hoverCard.source.id" />
    </div>

    <Teleport to="body">
      <Transition name="sheet">
        <div
          v-if="mobilePreviewSource"
          class="sync-mobile-source-backdrop md:hidden"
          :style="{ zIndex: OVERLAY_LAYERS.filterSheet }"
          @click.self="closeMobileSourcePreview"
        >
          <section
            class="sync-mobile-source-sheet"
            role="dialog"
            aria-modal="true"
            :aria-label="`${sourceDisplayName(mobilePreviewSource)} 来源详情`"
          >
            <div class="sheet-handle" />
            <SourceSummaryContent :source="mobilePreviewSource" :repairing="repairingSourceId === mobilePreviewSource.id">
              <template #header-action>
                <button class="icon-button sync-mobile-source-sheet__close" type="button" aria-label="关闭来源详情" @click="closeMobileSourcePreview">
                  <AppIcon name="close" :size="16" />
                </button>
              </template>
            </SourceSummaryContent>
            <div class="sync-mobile-source-sheet__actions">
              <button
                class="btn btn-primary"
                type="button"
                :disabled="isAnySyncing || (mobilePreviewSource.type === 'playlist' && !mobilePreviewSource.enabled)"
                @click="mobilePreviewSource.type === 'playlist' ? syncSource(mobilePreviewSource) : syncSource(mobilePreviewSource, true)"
              >
                <AppIcon
                  :name="mobilePreviewSource.type === 'playlist' ? 'sync' : 'download'"
                  :size="14"
                  :class="(syncingSourceId === mobilePreviewSource.id || forceFullId === mobilePreviewSource.id) ? 'animate-spin' : ''"
                />
                {{ mobilePreviewSource.type === 'playlist' ? '同步' : '下载' }}
              </button>
              <button class="btn btn-secondary" type="button" @click="toggleMobilePreviewSongs">
                <AppIcon name="chevronRight" :size="14" :class="expandedId === mobilePreviewSource.id ? 'rotate-90' : ''" />
                {{ expandedId === mobilePreviewSource.id ? '收起歌曲' : '展开歌曲' }}
              </button>
              <button class="btn btn-secondary" type="button" @click="editMobilePreviewSource">
                <AppIcon name="edit" :size="14" />
                编辑
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>

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
      :title="confirmRebuild?.type === 'album' ? '重新评估自动匹配并下载' : '重新评估自动匹配并同步'"
      :message="confirmRebuild?.type === 'album'
        ? `将保留人工决定，把此专辑范围内的自动绑定置为待重新评估，并立即执行全量下载对比。确定继续处理「${confirmRebuild?.name || ''}」吗？`
        : `将保留人工决定，把此同步源范围内的自动绑定置为待重新评估，并立即执行全量对比。确定继续处理「${confirmRebuild?.name || ''}」吗？`"
      :confirm-label="confirmRebuild?.type === 'album' ? '确认重新评估并下载' : '确认重新评估'"
      @confirm="handleRebuildSync"
      @cancel="confirmRebuild = null"
    />
    <ConfirmDialog
      :visible="!!confirmRedownload"
      title="重新下载托管音频并同步"
      message=""
      confirm-label="确认重新下载"
      variant="danger"
      :busy="redownloadSyncId === confirmRedownload?.id"
      :confirm-disabled="redownloadPreviewLoading || !!redownloadPreviewError || !redownloadPreview?.snapshotAvailable"
      @confirm="handleRedownloadSync"
      @cancel="closeRedownloadConfirm"
    >
      <div class="mb-6 space-y-4 text-sm leading-6 text-muted">
        <p>
          将处理「{{ confirmRedownload ? sourceDisplayName(confirmRedownload) : '' }}」当前同步范围内的歌曲。新音频通过格式校验并完成写标后才会原子替换；单曲失败时保留旧文件和 Plex 条目。
        </p>
        <div v-if="redownloadPreviewLoading" class="rounded-xl border p-3" aria-live="polite">
          正在检查本地文件归属…
        </div>
        <div v-else-if="redownloadPreviewError" class="rounded-xl border p-3 text-danger" role="alert">
          {{ redownloadPreviewError }}
        </div>
        <dl v-else-if="redownloadPreview" class="grid grid-cols-2 gap-2 rounded-xl border p-3">
          <div><dt class="text-muted-deep">当前范围</dt><dd class="font-semibold text-primary">{{ redownloadPreview.total }} 首</dd></div>
          <div><dt class="text-muted-deep">默认处理</dt><dd class="font-semibold text-primary">{{ redownloadPreview.eligible }} 首</dd></div>
          <div><dt class="text-muted-deep">YunPlex 文件</dt><dd>{{ redownloadPreview.managed }} 首</dd></div>
          <div><dt class="text-muted-deep">缺失/未下载</dt><dd>{{ redownloadPreview.missing }} 首</dd></div>
          <div><dt class="text-muted-deep">保护外部文件</dt><dd>{{ redownloadPreview.protectedExternal }} 首</dd></div>
          <div><dt class="text-muted-deep">保护人工绑定</dt><dd>{{ redownloadPreview.protectedManual }} 首</dd></div>
        </dl>
        <label
          v-if="redownloadPreview?.protectedExternal"
          class="flex cursor-pointer items-start gap-3 rounded-xl border p-3"
        >
          <input v-model="takeOverExternal" class="mt-1" type="checkbox">
          <span>
            <strong class="block text-primary">接管并替换外部文件</strong>
            <span class="text-muted-deep">这会把非 YunPlex 下载的 {{ redownloadPreview.protectedExternal }} 首文件纳入管理并覆盖原文件。人工绑定仍不会被覆盖。</span>
          </span>
        </label>
        <p class="text-danger">此操作会产生大量网络流量和磁盘写入，且不会清空既有匹配身份。</p>
      </div>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AddPlaylistDialog from '~/components/sources/AddPlaylistDialog.vue'
import EditSourceDialog from '~/components/sources/EditSourceDialog.vue'
import SourceOverflowActions from '~/components/sources/SourceOverflowActions.vue'
import SourceSongDetails from '~/components/sources/SourceSongDetails.vue'
import SourceSummaryContent from '~/components/sources/SourceSummaryContent.vue'
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import { useSyncSourcesPage } from '~~/composables/useSyncSourcesPage'
import { OVERLAY_LAYERS } from '~~/lib/overlay-layers'

const {
  advancedFilterCount, advancedFilterLabel, allSources, allVisibleSelected, applyDraftFilters, batchDeleting, batchLoading, batchToggling,
  canBatchSyncSelected, canBatchToggleSelected, canDragReorder, clearSourceFilters, closeRedownloadConfirm, confirmBatchDelete, confirmDelete, confirmRebuild, confirmRedownload,
  clearHoverHideTimer, desktopActionDensity, draftEnabledFilter, draftIssueFilter, draftStatusFilter, draftSubscribedFilter, dragIdx, dragOverIdx, editTarget,
  enabledCount, expandedId, expandedLoading, expandedSongs, filteredSources, filterType, forceFullId, formatRelative,
  handleBatchDelete, handleDelete, handleRebuildSync, handleRedownloadSync, hoverCard, isAnySyncing, lastSyncTime, loading, moreMenuId,
  onAlbumCreated, onDragEnd, onDragLeave, onFilteredDragOver, onFilteredDragStart, onFilteredDrop, onPlaylistCreated, onSourceSaved,
  onSourceSearchInput, onSourceTabChange, openAddPlaylist, openBatchDeleteConfirm, openEdit, openRebuildConfirm, openRedownloadConfirm, plexTargetHint, plexTargetName,
  prepareDraftFilters, redownloadPreview, redownloadPreviewError, redownloadPreviewLoading, redownloadSyncId, refreshSources, removeSourceFilter, repairingSourceId, repairProgress, repairSource, resetDraftFilters,
  runSelectedBatch, scheduleHideSourceHover, selectedCount, selectedSourceIds, showAdd, showInlineEditAction, showInlineFullSyncAction, showInlineRepairAction,
  showSourceHover, someVisibleSelected, sourceCanClear, sourceCoverSrc, sourceDisplayName, sourceFilterChips,
  retrySourceIssues, sourceIssueActionLabel, sourceIssueCount, sourceIssueSummary, sourceMetaLabel, sourceOriginName, sourcePageTabs, sourceSearch,
  sourceStateClass, sourceStateLabel, statusFilterOptions, syncingSourceId, syncResultDotClass, syncResultLabel, syncResultTextClass, syncSource, tableShellRef,
  toggleEnabled, toggleExpand, toggleMoreMenu, toggleSelectAllVisible, toggleSourceSelection, togglingId, totalActionableFailures, totalCopyright,
  takeOverExternal, totalSourceCount,
} = useSyncSourcesPage()

const mobilePreviewSource = ref<PlaylistSource | null>(null)

function openMobileSourcePreview(source: PlaylistSource) {
  clearHoverHideTimer()
  hoverCard.value = null
  mobilePreviewSource.value = source
}

function closeMobileSourcePreview() {
  mobilePreviewSource.value = null
}

function toggleMobilePreviewSongs() {
  if (!mobilePreviewSource.value) return
  toggleExpand(mobilePreviewSource.value.id)
}

function editMobilePreviewSource() {
  if (!mobilePreviewSource.value) return
  openEdit(mobilePreviewSource.value)
  closeMobileSourcePreview()
}

function closeMobilePreviewOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMobileSourcePreview()
}

onMounted(() => {
  window.addEventListener('keydown', closeMobilePreviewOnEscape)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', closeMobilePreviewOnEscape)
})
</script>

<!-- These page-specific BEM classes also style extracted child components. -->
<style>
@import '~/assets/css/pages/sync-sources-layout.css';
@import '~/assets/css/pages/sync-sources-table.css';
</style>
