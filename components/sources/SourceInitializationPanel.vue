<template>
  <section class="source-adoption" :aria-busy="loading">
    <div v-if="!applicable" class="section-card p-8"><EmptyState title="已保存专辑无需首次媒体接管" description="专辑继续使用现有下载与 Plex 导入流程。" /></div>
    <template v-else>
      <div class="section-card source-adoption__overview">
      <header class="source-adoption__hero">
        <div><h2>首次媒体接管</h2><p>先读取网易云和 Plex 生成方案；确认前不会下载，也不会修改 Plex。</p></div>
        <div class="source-adoption__actions">
          <StatusBadge :status="statusTone" :label="statusLabel" />
          <button v-if="canStart" class="btn btn-primary btn-sm" :disabled="acting" @click="start"><AppIcon name="search" :size="14" />开始分析</button>
          <button v-if="initialization?.status === 'pending' && !isWaitingAnalysis" class="btn btn-ghost btn-sm" :disabled="acting" @click="confirmSkip = true">跳过接管</button>
          <button v-if="isAnalyzing || isWaitingAnalysis" class="btn btn-secondary btn-sm" :disabled="acting" @click="cancel">取消分析</button>
          <button v-if="canRestart && !needsRestart" class="btn btn-secondary btn-sm" :disabled="acting" @click="confirmReanalysis = true">{{ needsRestart ? '规则已更新，重新分析' : '放弃方案并重新分析' }}</button>
        </div>
      </header>

      <div v-if="initialization" class="source-adoption__steps" aria-label="接管阶段"><div v-for="(step, index) in steps" :key="step.label" :class="{ 'is-current': step.current, 'is-done': step.done }"><span>{{ index + 1 }}</span><strong>{{ step.label }}</strong></div></div>
      <div v-if="initialization" class="source-adoption__metrics"><div v-for="metric in metrics" :key="metric.label"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong></div></div>
      <section v-if="initialization?.matchingConfig" class="matching-snapshot">
        <div class="matching-snapshot__heading"><div><strong>草案：{{ initialization.matchingConfig.config.enabled ? '增强（实验）' : '标准' }}匹配</strong><p>参数已随草案保存，修改设置不影响当前结果。</p></div>
        <NuxtLink class="btn btn-secondary btn-sm" :to="{ path: '/config', query: { tab: 'matching', source: sourceId } }">初始化匹配设置</NuxtLink></div>
        <details><summary>查看分析参数</summary><pre>{{ JSON.stringify(initialization.matchingConfig, null, 2) }}</pre><small>分析时间：{{ initialization.analyzedAt }} · 参数指纹：{{ initialization.matchingConfigFingerprint?.slice(0, 12) }}</small></details>
        <p v-for="warning in initialization.matchingConfig.musicBrainz?.warnings ?? []" :key="warning" role="status">{{ warning }}</p>
      </section>
      </div>
      <aside v-if="initialization?.status === 'awaiting_review'" class="source-adoption__tools">
        <div class="source-adoption__tools-row"><AppIcon name="info" :size="17" /><strong>按需打开方案工具，审核列表保持在当前页面</strong><button class="btn btn-primary" :disabled="acting" @click="quickOpen = true">快速方案</button><button class="icon-button" :aria-expanded="toolsHintExpanded" :aria-label="toolsHintExpanded ? '收起方案工具提示' : '展开方案工具提示'" @click="toolsHintExpanded = !toolsHintExpanded"><Chevron :open="toolsHintExpanded" /></button></div>
        <p v-if="toolsHintExpanded">下一步：用“快速方案”批量确认，或点页面底部的“提交接管方案”。关闭面板会保留当前草稿，只有明确确认才会应用决定。</p>
        <p v-if="initialization.quickStatus === 'queued'" role="status">快速方案已排队，可打开面板查看或取消本次处理。</p>
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
      />
      <SourceInitializationReanalysis v-if="reanalysisOpened && initialization" :key="initialization.id" :visible="confirmReanalysis" :submit-error="error" :source-id="sourceId" :initialization="initialization" :busy="acting" @confirm="restartFromDrawer" @cancel="confirmReanalysis = false" />
      <nav v-if="canReview" class="source-adoption__groups" aria-label="候选分组">
        <button v-for="group in reviewGroups" :key="group.value" class="btn btn-ghost btn-sm source-adoption__group" :data-tone="group.value" :aria-pressed="group.value === activeGroup" @click="tier = group.value; reloadItems(1)"><AppIcon :name="group.value === 'recommended' || group.value === 'preserved' ? 'checkCircle' : group.value === 'conflict' ? 'warn' : group.value === 'needs_review' ? 'search' : 'music'" :size="14" />{{ group.label }} <span>{{ group.count }}</span></button>
      </nav>

      <p v-if="(error || itemsError) && !confirmReanalysis" class="source-adoption__error" role="alert">{{ error || itemsError }}</p>
      <div v-if="isAnalyzing || isWaitingAnalysis" class="section-card source-adoption__progress"><AppIcon name="loader" :size="18" class="animate-spin" /><div><strong>{{ isWaitingAnalysis ? '分析已排队，等待后台处理' : '正在构建 Plex 全库候选索引' }}</strong><p>{{ isWaitingAnalysis ? '请求已接受，页面会自动刷新分析进度。' : '可离开此页面，任务会在后台继续。' }}</p></div></div>

      <div v-if="needsRestart" class="section-card source-adoption__incompatible"><strong>接管规则已更新</strong><p>当前方案使用旧版匹配规则，仍可查看审核快照，但必须重新分析后才能编辑或提交。现有方案不会被应用。</p><button class="btn btn-primary btn-sm" :disabled="acting" @click="confirmReanalysis = true"><AppIcon name="refresh" :size="16" />重新分析当前歌单</button></div>

      <div v-if="initialization?.status === 'completed' && isCompatibleReview" class="section-card source-adoption__next">
        <div><strong>接管已完成</strong><p>接管决定已保存。下载和 Plex 歌单更新的结果请查看同步记录；需要再次同步时，点页面上方“同步”。</p></div>
        <div class="source-adoption__next-actions"><NuxtLink v-if="initialization.followUpRunId" :to="`/task-center/runs/${initialization.followUpRunId}`" class="btn btn-primary btn-sm">查看同步运行</NuxtLink><NuxtLink :to="{ path: `/sync-sources/${sourceId}`, query: { tab: 'runs' } }" class="btn btn-secondary btn-sm"><AppIcon name="activity" :size="14" />查看运行记录</NuxtLink></div>
      </div>

      <SourceInitializationReview
        v-if="canReview"
        :items="result.items"
        :total="result.total"
        :page="result.page"
        :page-size="result.pageSize"
        :selected="selected"
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
        @decide="handleReviewDecision"
        @open-evidence="openDrawer"
        @change-page="changePage"
      ><template #actions><button v-if="isCompatibleReview && initialization?.highConfidenceItems" class="btn btn-secondary btn-sm" :disabled="acting" @click="confirmHighConfidence = true">将 {{ initialization.highConfidenceItems }} 首高置信候选设为使用 Plex</button></template></SourceInitializationReview>

      <SourceInitializationSummary v-if="isCompatibleReview && initialization?.status === 'awaiting_review' && initialization" :initialization="initialization" :queue-depth="queueDepth" :download-concurrency="downloadConcurrency" :acting="acting" :can-commit="isEditable" @commit="confirmCommit = true" />
      <SourceInitializationEvidence :error="error" :item="drawerItem" :search-results="searchResults" :acting="acting" @close="drawerItem = null" @search="searchPlex" @adopt="adoptCurrentCandidate" @choose="chooseCandidate" @confirm-shared="confirmSharedMedia" />

      <ConfirmDialog :visible="confirmCommit" title="提交首次媒体接管方案" :message="commitMessage" confirm-label="确认并应用" :busy="acting" @confirm="confirmCommit = false; commit()" @cancel="confirmCommit = false" />
      <ConfirmDialog :visible="confirmHighConfidence" title="批量使用高置信 Plex 候选" :message="`将 ${initialization?.highConfidenceItems || 0} 首高置信候选的草案决定改为“使用 Plex”。这不会立即写入身份，仍需最终提交。`" confirm-label="更新草案" :busy="acting" @confirm="confirmHighConfidence = false; adoptAllHighConfidence()" @cancel="confirmHighConfidence = false" />
      <ConfirmDialog :visible="confirmSkip" title="跳过首次媒体接管" message="跳过后普通同步会立即恢复当前未验证媒体策略，可能排队下载大量歌曲。确定继续吗？" confirm-label="确认跳过" :busy="acting" @confirm="confirmSkip = false; skip()" @cancel="confirmSkip = false" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { evidenceGroups } from '../../shared/review-filter-groups'
import type { InitializationDecision, InitializationReviewItem } from '../../composables/useSourceInitialization'
import { useSourceInitialization } from '../../composables/useSourceInitialization'

const props = defineProps<{ sourceId: string; sourceType: 'playlist' | 'album' }>()
const emit = defineEmits<{ changed: [] }>()
const applicable = computed(() => props.sourceType === 'playlist')
const confirmCommit = ref(false)
const confirmSkip = ref(false)
const confirmReanalysis = ref(false)
const reanalysisOpened = ref(false)
const quickOpen = ref(false)
const toolsHintExpanded = ref(true)
watch(confirmReanalysis, value => { if (value) reanalysisOpened.value = true })
async function restartFromDrawer() { await restart(); if (!error.value) confirmReanalysis.value = false }
const confirmHighConfidence = ref(false)

const state = useSourceInitialization({ sourceId: props.sourceId, onChanged: () => emit('changed') })
const { initialization, downloadConcurrency, queueDepth, loading, loadingItems, acting, error, itemsError, result, tier, decision, search, selected, drawerItem, searchResults, isAnalyzing, isWaitingAnalysis, isEditable, needsRestart, canReview, tierLabel, load, reloadItems, start, cancel, skip, restart, decideOne, decideSelected, adoptAllHighConfidence, toggle, togglePage, onSearch, clearFilters, changePage, openDrawer, searchPlex, chooseCandidate, confirmSharedMedia, commit } = state

const tierOptions = [
  ['strong_id', '强身份'], ['high_confidence', '高置信'], ['possible', '可能候选'], ['ambiguous', '歧义'],
  ['unmatched', '未匹配'], ['metadata_missing', '元数据缺失'], ['conflict', '冲突'], ['preserved', '已有绑定'],
].map(([value, label]) => ({ value, label }))

const canStart = computed(() => !initialization.value || (['pending', 'failed', 'cancelled'].includes(initialization.value.status) && !isWaitingAnalysis.value))
const canRestart = computed(() => Boolean(initialization.value && ['awaiting_review', 'completed', 'skipped'].includes(initialization.value.status)))
const isCompatibleReview = computed(() => Boolean(initialization.value && initialization.value.rulesCompatible))
const statusLabel = computed(() => ({ pending: '待接管', analyzing: '分析中', awaiting_review: '等待确认', applying: '应用中', completed: '已完成', failed: '失败', cancelled: '已取消', skipped: '已跳过' } as Record<string, string>)[initialization.value?.status || 'pending'] || '待接管')
const statusTone = computed(() => initialization.value?.status === 'completed' ? 'ok' : initialization.value?.status === 'failed' ? 'error' : isAnalyzing.value ? 'running' : 'warning')
const metrics = computed(() => [
  { label: '目标歌曲', value: initialization.value?.totalItems || 0, hint: '本次快照' }, { label: '已有绑定', value: initialization.value?.preservedItems || 0, hint: '继续保留' },
  { label: '本次接管', value: initialization.value?.adoptItems || 0, hint: '草案选择' },
  { label: '计划下载', value: initialization.value?.downloadItems || 0, hint: '提交方案后处理' },
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
const steps = computed(() => ['分析候选', '确认方案', '应用决定', '普通同步'].map((label, index) => {
  const rank = ({ pending: 0, analyzing: 0, awaiting_review: 1, applying: 2, completed: 3 } as Record<string, number>)[initialization.value?.status || 'pending'] ?? 0
  return { label, current: index === rank, done: index < rank }
}))
const commitMessage = computed(() => `将接管 ${initialization.value?.adoptItems || 0} 首、计划下载 ${initialization.value?.downloadItems || 0} 首、暂缓 ${initialization.value?.deferredItems || 0} 首、冲突 ${initialization.value?.conflictItems || 0} 首。后续下载并发为 ${downloadConcurrency.value}；确认前没有产生下载或 Plex 修改。`)

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
.source-adoption__next p { margin: var(--space-1) 0 0; color: var(--text-secondary); font-size: var(--text-xs); }
.source-adoption__next-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
@media (max-width: 640px) {
  .source-adoption__next { align-items: stretch; flex-direction: column; }
  .source-adoption__next-actions .btn { justify-content: center; }
}
</style>
