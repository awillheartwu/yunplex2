<template>
  <div class="task-center-page">
    <PageHeader
      description="执行中的工作、过去的记录，以及等待你处理的事项。"
    />

    <div class="activity-workspace">
      <PageTabs class="activity-navigation" :model-value="activeTab" :tabs="taskCenterTabs" aria-label="活动视图" @update:model-value="onTaskCenterTabChange" />
    <div class="activity-content">

      <ActivityOverview v-if="activeTab === 'overview'" />

      <section v-else-if="activeTab === 'failures'" class="space-y-4">
        <div class="failure-toolbar">
          <div class="failure-status-tabs" role="group" aria-label="异常状态筛选">
            <button v-for="item in failureStatusTabs" :key="item.value" type="button" :aria-pressed="failures.filter.value.status === item.value" :class="{ 'is-active': failures.filter.value.status === item.value }" @click="setFailureStatus(item.value)">
              {{ item.label }}
            </button>
          </div>
          <ListSelect :model-value="failures.view.value" aria-label="异常展示方式" :options="[{ value: 'groups', label: '按原因汇总' }, { value: 'songs', label: '逐首查看' }]" @change="setFailureView" />
        </div>

        <FilterBar
          :search="failures.filter.value.search || ''"
          placeholder="搜索歌曲、艺人、原因或来源"
          search-label="搜索异常记录"
          :active-count="failureAdvancedFilterCount"
          :can-clear="failureCanClear"
          advanced
          :advanced-label="failureAdvancedFilterLabel"
          advanced-title="筛选条件"
          @update:search="onFailureSearch"
          @clear="clearFailureFilters"
          @advanced-open="prepareFailureDraftFilters"
        >
          <template #advanced>
            <div class="filter-sheet-group">
              <p class="filter-sheet-group__label">运行类型</p>
              <FilterSegmentGroup v-model="draftFailureType" aria-label="运行类型" :options="failureTypeFilters" />
            </div>
            <div class="filter-sheet-group">
              <p class="filter-sheet-group__label">异常原因</p>
              <ListSelect v-model="draftFailureKind" class="list-select--block" aria-label="异常原因" :options="failureKindFilters" />
            </div>
            <div class="filter-sheet-group">
              <ListSelect v-model="draftFailureSource" class="list-select--block" label="来源" aria-label="来源" :options="[{ value: '', label: '全部来源' }, ...sourceOptions.map(source => ({ value: source.id, label: sourceOptionLabel(source) }))]" />
            </div>
            <FilterDateRange :model-value="draftFailureDateFilter" :min-date="null" @update:model-value="setDraftFailureDate" />
          </template>

          <template #advanced-footer="{ close }">
            <button class="btn btn-ghost" type="button" @click="resetFailureDraftFilters">重置</button>
            <button class="btn btn-primary" type="button" @click="applyFailureDraftFilters(close)">应用</button>
          </template>

          <template #active-filters>
            <button
              v-for="chip in failureFilterChips"
              :key="chip.key"
              type="button"
              class="filter-chip filter-chip-active filter-chip--removable"
              :aria-label="`移除筛选：${chip.label}`"
              @click="removeFailureFilter(chip.key)"
            >
              <span>{{ chip.label }}</span>
              <span class="filter-chip__remove" aria-hidden="true"><AppIcon name="close" :size="12" /></span>
            </button>
          </template>

          <template #actions>
            <button class="btn btn-ghost btn-xs" type="button" :disabled="failures.loading.value" @click="failures.fetch()">
              <AppIcon :name="failures.loading.value ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': failures.loading.value }" />
              刷新
            </button>
          </template>
          <template #summary>
            <span v-if="failures.total.value > 0">共 {{ failures.total.value }} 个问题<span v-if="failures.view.value === 'groups'"> · {{ failures.groupTotal.value }} 类原因</span></span>
          </template>
        </FilterBar>

        <section v-if="failures.filter.value.groupId" class="failure-group-context" aria-label="当前分组的公共原因">
          <header class="failure-group-context__header">
            <span class="failure-group__icon" :class="semanticToneClass(failureKindTone(failures.activeGroup.value?.failureKind || failures.items.value[0]?.failureKind || 'unknown_error'))"><AppIcon name="info" :size="20" /></span>
            <div class="failure-group-context__heading">
              <p>公共原因 · {{ failures.total.value }} 个问题</p>
              <h3>{{ failures.activeGroup.value?.label || (failures.items.value[0] ? failureKindLabel(failures.items.value[0].errorCode || failures.items.value[0].failureKind) : '当前原因分组') }}</h3>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" @click="setFailureView('groups')"><AppIcon name="chevronLeft" :size="14" />返回原因分组</button>
          </header>
          <p v-if="failures.activeGroup.value" class="failure-group-context__reason">{{ failures.activeGroup.value.failureReason }}</p>
          <p v-else-if="!failures.loading.value && failures.items.value[0]" class="failure-group-context__reason">{{ failureReasonLabel(failures.items.value[0]) }}</p>
          <p v-else class="failure-group-context__reason">{{ failures.loading.value ? '正在读取公共原因…' : failures.error.value ? '公共原因读取失败，请刷新后重试。' : '这个分组当前没有符合筛选条件的问题。' }}</p>
        </section>

        <div v-if="failures.view.value === 'songs' && (failures.items.value.length || failures.selectionCount.value)" class="failure-batch-bar" role="region" aria-label="异常批量选择与处理">
          <div class="failure-batch-bar__selection">
            <label class="failure-batch-bar__select-page">
              <input type="checkbox" :checked="failures.allPageSelected.value" :indeterminate.prop="failures.somePageSelected.value" :disabled="failures.selectionBusy.value || !failures.items.value.length" aria-label="全选本页异常" @change="failures.togglePageSelection()" />
              <span>全选本页</span>
            </label>
            <button v-if="failures.total.value > failures.items.value.length" class="btn btn-soft btn-sm" type="button" :disabled="failures.selectionBusy.value || (failures.allMatchingSelected.value && failures.selectionCount.value === failures.total.value)" @click="failures.selectAllMatching()">全选全部 {{ failures.total.value }} 项</button>
            <button v-if="failures.selectionCount.value" class="btn btn-ghost btn-sm" type="button" :disabled="failures.mutating.value" @click="failures.clearSelection()">清空选择</button>
          </div>
          <span class="failure-batch-bar__count" role="status">{{ failures.allMatchingSelected.value ? `已选 ${failures.selectionCount.value} / ${failures.total.value} 项 · 全部筛选结果` : failures.selectionCount.value ? `已选 ${failures.selectionCount.value} 项 · 跨页保留` : '可跨页选择' }}<small v-if="failures.selectionCount.value && failureCanProcess">可重试 {{ failures.selectionRetryableCount.value }} 项</small></span>
          <div v-if="failures.selectionCount.value" class="failure-batch-bar__actions">
            <button v-if="failureCanProcess" class="btn btn-primary btn-sm" type="button" :disabled="failures.selectionBusy.value || !failures.selectionRetryableCount.value" :title="failures.selectionRetryableCount.value ? '重新处理所选歌曲，复用已有音频和 Plex 媒体' : '当前选择没有可重新处理的歌曲或文件任务'" @click="batchRetry">批量重试</button>
            <button v-if="failureCanIgnore" class="btn btn-secondary btn-sm" type="button" :disabled="failures.selectionBusy.value" @click="batchIgnore">批量忽略</button>
          </div>
        </div>

        <p v-if="failures.error.value" role="alert" class="text-danger">读取失败，保留上次结果：{{ failures.error.value }}</p>
        <div v-if="failures.loading.value && !failures.visibleCount.value && !failures.error.value" class="task-loading">正在加载异常记录…</div>
        <EmptyState v-else-if="!failures.visibleCount.value && !failures.error.value" :title="failureEmptyTitle" :description="failureEmptyDescription" />
        <div v-else-if="failures.view.value === 'groups'" ref="failureListRoot" class="failure-groups">
          <article v-for="group in failures.groups.value" :key="group.key" class="section-card failure-group">
            <header class="failure-group__header">
              <span class="failure-group__icon" :class="semanticToneClass(failureKindTone(group.failureKind))"><AppIcon :name="failureKindIcon(group.failureKind)" :size="20" /></span>
              <div><h3>{{ group.label }}</h3><p>{{ group.total }} 个问题 · {{ group.songCount }} 首歌曲 · {{ group.sourceCount }} 个来源</p></div>
            </header>
            <p class="failure-group__reason">{{ group.failureReason }}</p>
            <div class="failure-row__meta"><span>首次 {{ formatTime(group.firstSeenAt) }}</span><span>最近 {{ formatTime(group.lastSeenAt) }}</span><span>累计出现 {{ group.occurrenceCount }} 次</span></div>
            <footer class="failure-group__footer">
              <span>{{ failureCanProcess ? group.retryableCount ? `${group.retryableCount} 项可重试` : group.retryUnavailableReason : '保留歌曲明细与关联运行' }}</span>
              <div class="failure-group__actions">
                <button class="btn btn-ghost btn-sm" type="button" :disabled="failures.loading.value || failures.mutating.value" @click="openFailureGroup(group)">查看歌曲<AppIcon name="chevronRight" :size="14" /></button>
                <button v-if="failureCanProcess && group.retryableCount" class="btn btn-secondary btn-sm" type="button" :disabled="failures.mutating.value || failures.loading.value" @click="mutateFailureGroup(group, 'retry')">重试 {{ group.retryableCount }} 项</button>
                <button v-if="failureCanIgnore" class="btn btn-ghost btn-sm" type="button" :disabled="failures.mutating.value || failures.loading.value" @click="mutateFailureGroup(group, 'ignore')">忽略本组 {{ group.total }} 项</button>
              </div>
            </footer>
          </article>
          <p v-if="failures.groups.value.length" class="failure-group-scope">分组操作作用于当前筛选下的整组问题，包括尚未展开的歌曲。</p>
          <PageNavigator :page="failures.page.value" :page-size="failures.pageSize" :total="failures.paginationTotal.value" label="异常原因" :loading="failures.loading.value" @change="failures.goToPage" />
        </div>
        <div v-else class="section-card failure-list">
          <article v-for="record in failures.items.value" :key="record.id" class="failure-row" :class="{ 'is-selected': failures.isSelected(record.id) }">
            <input type="checkbox" :checked="failures.isSelected(record.id)" :disabled="failures.selectionBusy.value" :aria-label="`选择 ${record.songName}`" @change="failures.toggleSelection(record.id)" />
            <div class="failure-row__main">
              <div class="failure-row__title">
                <strong>{{ record.songName }}</strong>
                <span>{{ record.artist }}</span>
                <span class="failure-kind" :class="semanticToneClass(failureKindTone(record.errorCode || record.failureKind))">
                  <AppIcon :name="failureKindIcon(record.errorCode || record.failureKind)" :size="11" />
                  {{ failureKindLabel(record.errorCode || record.failureKind) }}
                </span>
              </div>
              <p>{{ failureReasonLabel(record) }}</p>
              <div class="failure-row__meta">
                <span>{{ record.sourceName || runTypeLabel(record.runType) }}</span>
                <span>首次 {{ formatTime(record.firstSeenAt) }}</span>
                <span>最近 {{ formatTime(record.lastSeenAt) }}</span>
                <span>{{ record.occurrenceCount }} 次</span>
                <span v-if="record.retryCount > 0">已重试 {{ record.retryCount }} 次</span>
              </div>
            </div>
            <div class="failure-row__actions">
              <NuxtLink v-if="record.runId" :to="`/task-center/runs/${record.runId}`" class="btn btn-ghost btn-xs">查看运行</NuxtLink>
              <button v-if="['open', 'paused', 'ignored'].includes(record.status) && isRetryable(record)" class="btn btn-secondary btn-xs failure-row__retry-button" type="button" :disabled="failures.mutating.value || failures.loading.value" @click="retryFailure(record.id)">重试</button>
              <span
                v-else-if="['open', 'paused', 'ignored'].includes(record.status)"
                class="failure-row__retry-tooltip"
                tabindex="0"
                :aria-label="`重试不可用：${failureRetryUnavailableReason(record)}`"
              >
                <button
                  class="btn btn-secondary btn-xs failure-row__retry-button is-disabled"
                  type="button"
                  disabled
                  :title="failureRetryUnavailableReason(record)"
                >重试</button>
                <span class="failure-row__tooltip" role="tooltip">{{ failureRetryUnavailableReason(record) }}</span>
              </span>
              <NuxtLink v-if="record.sourceId && ['open', 'paused', 'ignored'].includes(record.status) && !isRetryable(record)" :to="`/sync-sources/${record.sourceId}`" class="btn btn-ghost btn-xs">查看收藏</NuxtLink>
              <button v-if="['open', 'paused'].includes(record.status)" class="btn btn-ghost btn-xs" type="button" :disabled="failures.mutating.value || failures.loading.value" @click="ignoreFailure(record.id)">忽略</button>
            </div>
          </article>
          <PageNavigator :page="failures.page.value" :page-size="failures.pageSize" :total="failures.total.value" label="异常记录" :loading="failures.loading.value" @change="failures.goToPage" />
        </div>
      </section>

      <RunRecordsPanel v-else />
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskCenterPage } from '~~/composables/useTaskCenterPage'
import type { FailureGroup } from '~~/server/lib/tasks/failure-groups'

const {
  activeTab, applyFailureDraftFilters, batchIgnore, batchRetry, clearFailureFilters,
  draftFailureDateFilter, draftFailureKind, draftFailureSource, draftFailureType,
  failureAdvancedFilterCount, failureAdvancedFilterLabel, failureCanClear, failureCanProcess, failureCanIgnore,
  failureEmptyDescription, failureEmptyTitle, failureFilterChips, failureKindFilters,
  failureKindIcon, failureKindLabel, failureKindTone, failureReasonLabel, failureRetryUnavailableReason, failures,
  failureStatusTabs, failureTypeFilters, formatTime, ignoreFailure, isRetryable,
  mutateFailureGroup, onFailureSearch, onTaskCenterTabChange, openFailureGroup: loadFailureGroup, prepareFailureDraftFilters,
  removeFailureFilter, resetFailureDraftFilters, retryFailure,
  runTypeLabel, semanticToneClass, setDraftFailureDate, setFailureStatus, sourceOptionLabel, sourceOptions,
  setFailureView, taskCenterTabs,
} = useTaskCenterPage()
const failureListRoot = ref<HTMLElement | null>(null)
async function openFailureGroup(group: FailureGroup) {
  const root = failureListRoot.value?.parentElement
  await loadFailureGroup(group)
  await nextTick()
  root?.scrollIntoView({ block: 'start' })
}
</script>

<style scoped>
@import '~/assets/css/pages/task-center.css';
@import '~/assets/css/pages/task-center-failures.css';
</style>
