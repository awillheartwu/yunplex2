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
        <div class="failure-status-tabs" role="tablist" aria-label="异常状态">
          <button v-for="item in failureStatusTabs" :key="item.value" role="tab" type="button" :aria-selected="failures.filter.value.status === item.value" :class="{ 'is-active': failures.filter.value.status === item.value }" @click="setFailureStatus(item.value)">
            {{ item.label }}
          </button>
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
              <p class="filter-sheet-group__label">失败阶段</p>
              <ListSelect v-model="draftFailureKind" class="list-select--block" aria-label="失败阶段" :options="failureKindFilters" />
            </div>
            <div class="filter-sheet-group">
              <ListSelect v-model="draftFailureSource" class="list-select--block" label="来源" aria-label="来源" :options="[{ value: '', label: '全部来源' }, ...sourceOptions.map(source => ({ value: source.id, label: sourceOptionLabel(source) }))]" />
            </div>
            <FilterDateRange :model-value="draftFailureDateFilter" :min-date="null" @update:model-value="setDraftFailureDate" />
          </template>

          <template #advanced-footer="{ close }">
            <button class="btn btn-secondary" type="button" @click="resetFailureDraftFilters">重置</button>
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
            <button class="btn btn-secondary btn-xs" type="button" :disabled="failures.loading.value" @click="failures.fetch()">
              <AppIcon :name="failures.loading.value ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': failures.loading.value }" />
              刷新
            </button>
          </template>
          <template #summary>
            <span v-if="failures.total.value > 0">共 {{ failures.total.value }} 个问题</span>
          </template>
        </FilterBar>

        <div v-if="selectedFailures.size > 0" class="failure-batch-bar">
          <span>已选 {{ selectedFailures.size }} 项</span>
          <button v-if="failures.filter.value.status === 'open'" class="btn btn-primary btn-xs" type="button" @click="batchRetry">批量重试</button>
          <button v-if="failures.filter.value.status === 'open'" class="btn btn-secondary btn-xs" type="button" @click="batchIgnore">批量忽略</button>
          <button v-if="failures.filter.value.status === 'ignored'" class="btn btn-secondary btn-xs" type="button" @click="batchReopen">恢复提醒</button>
          <button class="btn btn-ghost btn-xs" type="button" @click="selectedFailures.clear()">取消选择</button>
        </div>

        <p v-if="failures.error.value" role="alert" class="text-danger">读取失败，保留上次结果：{{ failures.error.value }}</p>
        <div v-if="failures.loading.value && failures.items.value.length === 0 && !failures.error.value" class="task-loading">正在加载异常记录…</div>
        <EmptyState v-else-if="failures.items.value.length === 0 && !failures.error.value" :title="failureEmptyTitle" :description="failureEmptyDescription" />
        <div v-else class="section-card failure-list">
          <article v-for="record in failures.items.value" :key="record.id" class="failure-row">
            <input type="checkbox" :checked="selectedFailures.has(record.id)" :aria-label="`选择 ${record.songName}`" @change="toggleFailure(record.id)" />
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
              <button v-if="record.status === 'open' && isRetryable(record)" class="btn btn-secondary btn-xs failure-row__retry-button" type="button" @click="retryFailure(record.id)">重试</button>
              <span
                v-else-if="record.status === 'open'"
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
              <button v-if="record.status === 'open'" class="btn btn-ghost btn-xs" type="button" @click="ignoreFailure(record.id)">忽略</button>
              <button v-if="record.status === 'ignored'" class="btn btn-secondary btn-xs" type="button" @click="reopenFailure(record.id)">恢复提醒</button>
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

const {
  activeTab, applyFailureDraftFilters, batchIgnore, batchReopen, batchRetry, clearFailureFilters,
  draftFailureDateFilter, draftFailureKind, draftFailureSource, draftFailureType,
  failureAdvancedFilterCount, failureAdvancedFilterLabel, failureCanClear, failureEmptyDescription, failureEmptyTitle, failureFilterChips, failureKindFilters,
  failureKindIcon, failureKindLabel, failureKindTone, failureReasonLabel, failureRetryUnavailableReason, failures,
  failureStatusTabs, failureTypeFilters, formatTime, ignoreFailure, isRetryable,
  onFailureSearch, onTaskCenterTabChange, prepareFailureDraftFilters,
  removeFailureFilter, reopenFailure, resetFailureDraftFilters, retryFailure,
  runTypeLabel, selectedFailures, semanticToneClass, setDraftFailureDate, setFailureStatus, sourceOptionLabel, sourceOptions,
  taskCenterTabs, toggleFailure,
} = useTaskCenterPage()
</script>

<style scoped>
@import '~/assets/css/pages/task-center.css';
@import '~/assets/css/pages/task-center-failures.css';
</style>
