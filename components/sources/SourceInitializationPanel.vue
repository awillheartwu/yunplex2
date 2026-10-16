<template>
  <section class="source-adoption" :aria-busy="loading">
    <div v-if="!applicable" class="section-card p-8"><EmptyState title="已保存专辑无需首次媒体接管" description="专辑继续使用现有下载与 Plex 导入流程。" /></div>
    <template v-else>
      <div class="section-card source-adoption__overview">
      <header class="source-adoption__hero">
        <div><h2>首次媒体接管</h2><p>先对比网易云和 Plex，生成接管方案。</p></div>
        <div class="source-adoption__actions">
          <StatusBadge class="source-adoption__status" :status="statusTone" :label="statusLabel" />
          <button v-if="canStart" class="btn btn-primary btn-sm" :disabled="acting" @click="start"><AppIcon name="search" :size="14" />开始分析</button>
          <button v-if="initialization?.status === 'pending' && !isWaitingAnalysis" class="btn btn-warning btn-sm" :disabled="acting" @click="confirmSkip = true">跳过接管</button>
          <button v-if="isAnalyzing || isWaitingAnalysis" class="btn btn-ghost btn-sm" :disabled="acting" @click="cancel">取消分析</button>
          <button v-if="canRestart && !needsRestart" class="btn btn-info btn-sm" :disabled="acting" @click="confirmReanalysis = true">重新分析</button>
        </div>
      </header>

      <div v-if="initialization" class="source-adoption__steps" aria-label="接管阶段"><div v-for="(step, index) in steps" :key="step.label" :class="{ 'is-current': step.current, 'is-done': step.done }"><span>{{ index + 1 }}</span><strong>{{ step.label }}</strong></div></div>
      <div v-if="initialization" class="source-adoption__metrics"><div v-for="metric in metrics" :key="metric.label"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong></div></div>
      <section v-if="initialization?.matchingConfig" class="matching-snapshot">
        <div class="matching-snapshot__heading"><div><strong>本次分析：{{ initialization.matchingConfig.config.enabled ? '增强匹配（实验）' : '标准匹配' }}</strong><p>结果按这份设置生成，之后修改设置不会影响它。</p></div>
        <NuxtLink class="btn btn-ghost btn-sm" :to="{ path: '/config', query: { tab: 'matching', source: sourceId } }">调整匹配设置</NuxtLink></div>
        <details><summary>查看本次使用的设置</summary><pre>{{ JSON.stringify(initialization.matchingConfig, null, 2) }}</pre><small>分析时间：{{ initialization.analyzedAt }} · 设置编号：{{ initialization.matchingConfigFingerprint?.slice(0, 12) }}</small></details>
        <p v-for="warning in initialization.matchingConfig.musicBrainz?.warnings ?? []" :key="warning" role="status">{{ warning }}</p>
      </section>
      </div>
      <aside v-if="initialization?.status === 'awaiting_review'" class="source-adoption__tools">
        <div class="source-adoption__tools-row"><AppIcon name="info" :size="17" /><strong>快速方案可批量处理，下方列表可逐首核对</strong><button class="btn btn-soft" :disabled="acting" @click="quickOpen = true">快速方案</button><button class="icon-button" :aria-expanded="toolsHintExpanded" :aria-label="toolsHintExpanded ? '收起快速方案提示' : '展开快速方案提示'" @click="toolsHintExpanded = !toolsHintExpanded"><Chevron :open="toolsHintExpanded" /></button></div>
        <p v-if="toolsHintExpanded">点“快速方案”按分数线批量确认；也可以逐首选择，最后用页面底部的“提交接管方案”完成。关闭快速方案会保留已选内容，提交后才会开始处理。</p>
        <p v-if="initialization.quickStatus === 'queued'" role="status">快速方案已开始处理，可打开面板查看进度或取消。</p>
      </aside>
      <SourceInitializationQuickPlan
        v-if="initialization?.status === 'awaiting_review'"
        :visible="quickOpen"
        :source-id="sourceId"
        :initialization="initialization"
        :busy="acting"
        :disabled="!isEditable"
        @close="quickOpen = false"
        @request-commit="quickOpen = false; confirmCommit = true"
        @changed="onQuickChanged"
        @submitted="emit('submitted')"
      />
      <SourceInitializationReanalysis v-if="reanalysisOpened && initialization" :key="initialization.id" :visible="confirmReanalysis" :submit-error="error" :source-id="sourceId" :initialization="initialization" :busy="acting" @confirm="restartFromDrawer" @cancel="confirmReanalysis = false" />
      <nav v-if="canReview" class="source-adoption__groups" aria-label="候选分组">
        <button v-for="group in reviewGroups" :key="group.value" class="btn btn-ghost btn-sm source-adoption__group" :data-tone="group.value" :aria-pressed="group.value === activeGroup" @click="tier = group.value; reloadItems(1)"><AppIcon :name="group.value === 'recommended' || group.value === 'preserved' ? 'checkCircle' : group.value === 'conflict' ? 'warn' : group.value === 'needs_review' ? 'search' : 'music'" :size="14" />{{ group.label }} <span>{{ group.count }}</span></button>
      </nav>

      <p v-if="(error || itemsError) && !confirmReanalysis" class="source-adoption__error" role="alert">{{ error || itemsError }}</p>
      <div v-if="isAnalyzing || isWaitingAnalysis" class="section-card source-adoption__progress"><AppIcon name="loader" :size="18" class="animate-spin" /><div><strong>{{ isWaitingAnalysis ? '分析已排队，等待后台处理' : '正在扫描 Plex 音乐库，生成候选' }}</strong><p>{{ isWaitingAnalysis ? '请求已收到，页面会自动刷新进度。' : '可以离开此页面，任务会在后台继续。' }}</p></div></div>

      <div v-if="needsRestart" class="section-card source-adoption__incompatible"><strong>匹配设置已更新</strong><p>当前结果由旧设置生成，可以查看，但不能修改或提交；请重新分析后再继续。</p><button class="btn btn-primary btn-sm" :disabled="acting" @click="confirmReanalysis = true"><AppIcon name="refresh" :size="16" />重新分析</button></div>
      <aside v-if="libraryChanged && !needsRestart" class="section-card source-adoption__library-change" role="status"><AppIcon name="info" :size="18" /><div><strong>Plex 音乐库有变化</strong><p>音乐库在分析后发生变化，当前选择已保留，可以重新分析查看最新候选。</p></div><button class="btn btn-info btn-sm" :disabled="acting" @click="confirmReanalysis = true">重新分析</button></aside>

      <div v-if="initialization?.status === 'completed' && isCompatibleReview" class="section-card source-adoption__next">
        <div><strong>接管已完成</strong></div>
        <div class="source-adoption__next-actions"><NuxtLink v-if="initialization.followUpRunId" :to="`/task-center/runs/${initialization.followUpRunId}`" class="btn btn-primary btn-sm">查看同步运行</NuxtLink><NuxtLink :to="{ path: `/sync-sources/${sourceId}`, query: { tab: 'runs' } }" class="btn btn-ghost btn-sm"><AppIcon name="activity" :size="14" />查看运行记录</NuxtLink></div>
      </div>

      <SourceInitializationReview
        v-if="canReview"
        :items="result.items"
        :total="result.total"
        :page="result.page"
        :page-size="result.pageSize"
        :selected-count="selectedCount"
        :all-matching-selected="allMatchingSelected"
        :can-select-all-matching="canSelectAllMatching"
        :can-adopt-selected="canAdoptSelected"
        :selection-category-label="selectionCategoryLabel"
        :is-selected="isSelected"
        :loading="loadingItems"
        :acting="acting"
        :editable="isEditable"
        :search="search"
        :tier="tier"
        :decision="decision"
        :tier-options="tierOptions"
        :tier-label="tierLabel"
        @update:search="onSearch"
        @update:tier="tier = $event"
        @update:decision="decision = $event"
        @clear="clearFilters"
        @reload="reloadItems(1)"
        @toggle="toggle"
        @toggle-page="togglePage"
        @select-all-matching="selectAllMatching"
        @clear-selection="clearSelection"
        @decide="handleReviewDecision"
        @open-evidence="openDrawer"
        @change-page="changePage"
      ><template #actions><button v-if="isCompatibleReview && initialization?.highConfidenceItems" class="btn btn-soft btn-sm" :disabled="acting" @click="confirmHighConfidence = true">批量设为使用 Plex（{{ initialization.highConfidenceItems }} 首）</button></template></SourceInitializationReview>

      <SourceInitializationSummary v-if="isCompatibleReview && initialization?.status === 'awaiting_review' && initialization" :initialization="initialization" :queue-depth="queueDepth" :download-concurrency="downloadConcurrency" :acting="acting" :can-commit="isEditable" @commit="confirmCommit = true" />
      <SourceInitializationEvidence :error="error" :item="drawerItem" :search-results="searchResults" :acting="acting" @close="drawerItem = null" @search="searchPlex" @adopt="adoptCurrentCandidate" @choose="chooseCandidate" @confirm-shared="confirmSharedMedia" />

      <ConfirmDialog :visible="confirmCommit" title="提交接管方案" :message="commitMessage" confirm-label="确认并应用" :busy="acting" @confirm="submitCommit" @cancel="confirmCommit = false" />
      <ConfirmDialog :visible="confirmHighConfidence" title="批量设为使用 Plex" :message="`把 ${initialization?.highConfidenceItems || 0} 首推荐匹配候选改为“使用 Plex”。只修改当前选择，点“提交接管方案”后才会生效。`" confirm-label="确认修改" :busy="acting" @confirm="confirmHighConfidence = false; adoptAllHighConfidence()" @cancel="confirmHighConfidence = false" />
      <ConfirmDialog :visible="confirmSkip" title="跳过首次媒体接管" message="跳过后，普通同步会按默认方式处理这些歌曲，可能开始批量下载。确定跳过吗？" confirm-label="确认跳过" :busy="acting" @confirm="confirmSkip = false; skip()" @cancel="confirmSkip = false" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { evidenceGroups } from '../../shared/review-filter-groups'
import type { InitializationDecision, InitializationReviewItem } from '../../composables/useSourceInitialization'
import { useSourceInitialization } from '../../composables/useSourceInitialization'

const props = defineProps<{ sourceId: string; sourceType: 'playlist' | 'album' }>()
const emit = defineEmits<{ changed: []; submitted: [] }>()
const applicable = computed(() => props.sourceType === 'playlist')
const confirmCommit = ref(false)
const confirmSkip = ref(false)
const confirmReanalysis = ref(false)
const reanalysisOpened = ref(false)
const quickOpen = ref(false)
const toolsHintExpanded = ref(true)
watch(confirmReanalysis, value => { if (value) reanalysisOpened.value = true })
async function restartFromDrawer() { await restart(); if (!error.value) confirmReanalysis.value = false }
async function submitCommit(): Promise<void> { confirmCommit.value = false; if (await commit()) emit('submitted') }
const confirmHighConfidence = ref(false)

const state = useSourceInitialization({ sourceId: props.sourceId, onChanged: () => emit('changed') })
const { initialization, libraryChanged, downloadConcurrency, queueDepth, loading, loadingItems, acting, error, itemsError, result, tier, decision, search, selectedCount, allMatchingSelected, canSelectAllMatching, canAdoptSelected, selectionCategoryLabel, isSelected, selectAllMatching, clearSelection, drawerItem, searchResults, isAnalyzing, isWaitingAnalysis, isEditable, needsRestart, canReview, tierLabel, load, reloadItems, start, cancel, skip, restart, decideOne, decideSelected, adoptAllHighConfidence, toggle, togglePage, onSearch, clearFilters, changePage, openDrawer, searchPlex, chooseCandidate, confirmSharedMedia, commit } = state

const tierOptions = [
  ['strong_id', '明确匹配'], ['high_confidence', '推荐匹配'], ['possible', '需要核对'], ['ambiguous', '多个相近结果'],
  ['unmatched', '未匹配'], ['metadata_missing', '信息不完整'], ['conflict', '冲突'], ['preserved', '已确认文件'],
].map(([value, label]) => ({ value, label }))

const canStart = computed(() => !initialization.value || (['pending', 'failed', 'cancelled'].includes(initialization.value.status) && !isWaitingAnalysis.value))
const canRestart = computed(() => Boolean(initialization.value && ['awaiting_review', 'completed', 'skipped'].includes(initialization.value.status)))
const isCompatibleReview = computed(() => Boolean(initialization.value && initialization.value.rulesCompatible))
const statusLabel = computed(() => ({ pending: '待接管', analyzing: '分析中', awaiting_review: '等待确认', applying: '应用中', completed: '已完成', failed: '失败', cancelled: '已取消', skipped: '已跳过' } as Record<string, string>)[initialization.value?.status || 'pending'] || '待接管')
const statusTone = computed(() => initialization.value?.status === 'completed' ? 'ok' : initialization.value?.status === 'failed' ? 'error' : isAnalyzing.value ? 'running' : 'warning')
const metrics = computed(() => [
  { label: '歌单歌曲', value: initialization.value?.totalItems || 0 }, { label: '已确认文件', value: initialization.value?.preservedItems || 0 },
  { label: '使用 Plex', value: initialization.value?.adoptItems || 0 },
  { label: '计划下载', value: initialization.value?.downloadItems || 0 },
])
const activeGroup = computed(() => evidenceGroups.find(group => group.value === tier.value || group.members.includes(tier.value))?.value ?? '')
const reviewGroups = computed(() => {
  const item = initialization.value
  return [{ value: '', label: '全部', count: item?.totalItems ?? 0 }, ...evidenceGroups.map((group, index) => ({ ...group, count: [
    (item?.strongItems ?? 0) + (item?.highConfidenceItems ?? 0),
    (item?.possibleItems ?? 0) + (item?.ambiguousItems ?? 0),
    item?.unmatchedItems ?? 0, item?.conflictItems ?? 0, item?.preservedItems ?? 0,
  ][index] }))]
})
const steps = computed(() => ['分析候选', '确认方案', '保存选择', '普通同步'].map((label, index) => {
  const rank = ({ pending: 0, analyzing: 0, awaiting_review: 1, applying: 2, completed: 3 } as Record<string, number>)[initialization.value?.status || 'pending'] ?? 0
  return { label, current: index === rank, done: index < rank }
}))
const commitMessage = computed(() => `将使用 Plex ${initialization.value?.adoptItems || 0} 首、下载 ${initialization.value?.downloadItems || 0} 首、暂缓 ${initialization.value?.deferredItems || 0} 首、冲突 ${initialization.value?.conflictItems || 0} 首。启用中的收藏会继续下载并更新 Plex 歌单；暂停的收藏需要手动同步。下载同时最多 ${downloadConcurrency.value} 首。`)

async function adoptCurrentCandidate(item: InitializationReviewItem): Promise<void> {
  await decideOne(item.neteaseSongId, 'adopt')
  if (!error.value) drawerItem.value = null
}

function onQuickChanged(): void {
  void load()
  emit('changed')
}

function handleReviewDecision(songId: number, value: InitializationDecision): void {
  if (songId === 0) void decideSelected(value)
  else void decideOne(songId, value)
}
</script>

<style scoped>
@import '~/assets/css/components/source-initialization-shared.css';
@import '~/assets/css/components/source-initialization-panel.css';
.matching-snapshot { min-width: 0; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border-primary); display: grid; gap: var(--space-3); font-size: var(--text-sm); }
.matching-snapshot__heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
.matching-snapshot__heading p { margin: var(--space-1) 0 0; color: var(--text-secondary); font-size: var(--text-xs); }
.matching-snapshot__heading .btn { flex: none; }
.matching-snapshot details { min-width: 0; border-top: 1px solid var(--border-primary); padding-top: var(--space-3); }
.matching-snapshot summary { width: fit-content; cursor: pointer; color: var(--text-secondary); font-size: var(--text-xs); }
.matching-snapshot pre { overflow: auto; max-height: 20rem; font-size: var(--text-xs); }
.matching-snapshot small { overflow-wrap: anywhere; }
.source-adoption__next { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-4); }
.source-adoption__next > div:first-child { flex: 1; min-width: 12rem; }
.source-adoption__next-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
@media (max-width: 640px) {
  .source-adoption__next { align-items: stretch; flex-direction: column; }
  .source-adoption__next-actions .btn { justify-content: center; }
}
</style>
