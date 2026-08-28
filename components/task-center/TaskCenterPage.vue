<template>
  <div class="task-center-page">
    <PageHeader
      description="集中查看正在执行的工作、历史运行结果和需要处理的问题"
    />

    <PageTabs
      :model-value="activeTab"
      :tabs="taskCenterTabs"
      aria-label="任务中心视图"
      @change="onTaskCenterTabChange"
    />

    <main>
      <section v-if="activeTab === 'overview'" class="task-overview">
        <div class="task-overview__summary">
          <article v-if="syncState?.isRunning" class="section-card task-live-card">
            <div class="task-live-card__top">
              <div class="task-live-card__heading">
                <div class="task-live-card__eyebrow">
                  <span class="task-live-card__pulse" />
                  当前同步
                </div>
                <h3>{{ liveTitle }}</h3>
                <p>{{ liveDescription }}</p>
              </div>
              <div class="task-live-card__progress">
                <strong>{{ livePercent }}%</strong>
                <span>整体进度</span>
              </div>
            </div>
            <div
              class="task-live-card__bar"
              role="progressbar"
              aria-label="同步整体进度"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="livePercent"
            >
              <div :style="{ width: `${livePercent}%` }" />
            </div>

            <ol class="task-stage-rail" aria-label="同步步骤">
              <li
                v-for="stage in overviewStageItems"
                :key="stage.key"
                :class="`is-${stage.state}`"
                :aria-current="stage.state === 'current' ? 'step' : undefined"
              >
                <span class="task-stage-rail__marker">
                  <AppIcon v-if="stage.state === 'complete'" name="check" :size="11" />
                  <span v-else />
                </span>
                <span>{{ stage.label }}</span>
              </li>
            </ol>

            <div class="task-live-card__footer">
              <dl class="task-live-card__facts">
                <div>
                  <dt>当前项目</dt>
                  <dd :title="syncState.currentSong || syncState.currentSourceName || '正在准备'">
                    {{ syncState.currentSong || syncState.currentSourceName || '正在准备' }}
                  </dd>
                </div>
                <div>
                  <dt>已运行</dt>
                  <dd>{{ elapsedLabel }}</dd>
                </div>
                <div>
                  <dt>本轮异常</dt>
                  <dd :class="{ 'text-danger': (syncState.failures?.length || 0) > 0 }">{{ syncState.failures?.length || 0 }}</dd>
                </div>
              </dl>
              <div class="task-live-card__actions">
                <NuxtLink v-if="primaryActiveRun" :to="`/task-center/runs/${primaryActiveRun.id}`" class="btn btn-secondary btn-sm">查看详情</NuxtLink>
                <button class="btn btn-danger btn-sm" type="button" @click="handleCancelSync">取消同步</button>
              </div>
            </div>
          </article>

          <article v-else class="section-card task-idle-card">
            <div class="task-idle-card__status">
              <span class="task-idle-card__status-dot" />
              系统空闲
            </div>
            <div class="task-idle-card__empty">
              <h3>当前没有正在执行的任务</h3>
              <p>同步请从仪表盘或同步源发起，下载请从手动下载发起。</p>
            </div>
            <div class="task-idle-card__actions">
              <button class="btn btn-secondary btn-sm" type="button" @click="switchTab('runs')">查看运行记录</button>
            </div>
          </article>

          <section class="section-card issue-summary" :class="{ 'has-issues': openFailureTotal > 0 }">
            <div>
              <p class="issue-summary__eyebrow">需要处理</p>
              <strong class="issue-summary__count">{{ openFailureTotal }}</strong>
              <h3>{{ openFailureTotal > 0 ? '个问题等待处理' : '暂无待处理问题' }}</h3>
              <p>{{ openFailureTotal > 0 ? '失败项会在成功重试后自动关闭，也可以暂时忽略。' : '最近的运行没有留下未解决异常。' }}</p>
            </div>
            <button class="btn btn-secondary btn-sm" type="button" @click="switchTab('failures')">
              {{ openFailureTotal > 0 ? '处理问题' : '查看记录' }}
            </button>
          </section>
        </div>

        <section v-if="secondaryActiveRuns.length > 0" class="section-card compact-runs">
          <div class="compact-runs__header">
            <div>
              <h3>其他正在运行</h3>
              <p>手动下载可以与同步并行，不会在概览中被隐藏。</p>
            </div>
            <span>{{ secondaryActiveRuns.length }}</span>
          </div>
          <NuxtLink v-for="run in secondaryActiveRuns" :key="run.id" :to="`/task-center/runs/${run.id}`" class="compact-run">
            <RunTypeBadge :type="run.type" compact size="sm" />
            <span>{{ runSummaryLabel(run.summary) }}</span>
            <small>{{ formatElapsed(run.startedAt) }}</small>
            <AppIcon name="chevronRight" :size="13" />
          </NuxtLink>
        </section>

        <DownloadQueuePanel
          :status="downloadQueue.queueStatus.value"
          :live-tasks="downloadQueue.liveTasks.value"
          :loading="downloadQueue.loading.value"
          :error="downloadQueue.error.value"
          :sync-state="syncState"
          :active-run="primaryActiveRun"
          @refresh="downloadQueue.fetchAll()"
        />
      </section>

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
              <div class="filter-sheet-group__controls">
                <FilterChip v-for="item in failureTypeFilters" :key="item.value || 'all'" :active="draftFailureType === item.value" @click="draftFailureType = item.value">
                  {{ item.label }}
                </FilterChip>
              </div>
            </div>
            <div class="filter-sheet-group">
              <p class="filter-sheet-group__label">失败阶段</p>
              <div class="filter-sheet-group__controls">
                <FilterChip v-for="item in failureKindFilters" :key="item.value || 'all'" :active="draftFailureKind === item.value" @click="draftFailureKind = item.value">
                  {{ item.label }}
                </FilterChip>
              </div>
            </div>
            <div class="filter-sheet-group">
              <label class="filter-sheet-group__label" for="failure-source-filter">来源</label>
              <select id="failure-source-filter" v-model="draftFailureSource" class="form-input">
                <option value="">全部来源</option>
                <option v-for="source in sourceOptions" :key="source.id" :value="source.id">{{ sourceOptionLabel(source) }}</option>
              </select>
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

        <div v-if="failures.loading.value && failures.items.value.length === 0" class="task-loading">正在加载异常记录…</div>
        <EmptyState v-else-if="failures.items.value.length === 0" :title="failureEmptyTitle" :description="failureEmptyDescription" />
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
          <Pagination :has-more="failures.hasMore.value" :loading="failures.loadingMore.value" :current-count="failures.items.value.length" :total="failures.total.value" @load-more="failures.loadMore()" />
        </div>
      </section>

      <RunRecordsPanel v-else />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useTaskCenterPage } from '~~/composables/useTaskCenterPage'
import { runSummaryLabel } from '~~/lib/run-presentation'

const {
  activeTab, applyFailureDraftFilters, batchIgnore, batchReopen, batchRetry, clearFailureFilters,
  draftFailureDateFilter, draftFailureKind, draftFailureSource, draftFailureType,
  downloadQueue, elapsedLabel, failureAdvancedFilterCount, failureAdvancedFilterLabel, failureCanClear, failureEmptyDescription, failureEmptyTitle, failureFilterChips, failureKindFilters,
  failureKindIcon, failureKindLabel, failureKindTone, failureReasonLabel, failureRetryUnavailableReason, failures, formatElapsed,
  failureStatusTabs, failureTypeFilters, formatTime, handleCancelSync, ignoreFailure, isRetryable, liveDescription,
  livePercent, liveTitle, onFailureSearch, onTaskCenterTabChange, openFailureTotal, overviewStageItems, prepareFailureDraftFilters,
  primaryActiveRun, removeFailureFilter, reopenFailure, resetFailureDraftFilters, retryFailure,
  runTypeLabel, secondaryActiveRuns, selectedFailures, semanticToneClass, setDraftFailureDate, setFailureStatus, sourceOptionLabel, sourceOptions, switchTab,
  syncState, taskCenterTabs, toggleFailure,
} = useTaskCenterPage()
</script>

<style scoped>
@import '~/assets/css/pages/task-center.css';
</style>
