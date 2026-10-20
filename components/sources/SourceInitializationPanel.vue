<template>
  <section class="source-adoption" :aria-busy="loading">
    <div v-if="!applicable" class="section-card p-8"><EmptyState title="已保存专辑无需首次媒体接管" description="专辑继续使用现有下载与 Plex 导入流程。" /></div>
    <template v-else>
      <SourceInitializationProgress v-if="initialization && !['failed', 'cancelled', 'skipped'].includes(initialization.status)" :initialization="initialization" :processing="processing" @review="emit('media')" />
      <div class="section-card source-adoption__overview">
      <header class="source-adoption__hero">
        <div><h2>首次同步准备</h2><p>优先复用 Plex 中的音乐，缺少的尝试下载；可以先用起来，再调整匹配。</p></div>
        <div class="source-adoption__actions">
          <StatusBadge class="source-adoption__status" :status="statusTone" :label="statusLabel" />
          <template v-if="canStart">
            <ActionHint text="采用当前排序的第一个候选，没有候选的再下载"><button class="btn btn-secondary btn-sm" :disabled="acting" @click="start(true)">直接开始！</button></ActionHint>
            <ActionHint text="仔细查阅匹配方案并微调，适合对歌单匹配要求高的人"><button class="btn btn-primary btn-sm" :disabled="acting" @click="start(false)">审批初始化</button></ActionHint>
          </template>
          <button v-if="initialization?.status === 'pending' && !isWaitingAnalysis" class="btn btn-warning btn-sm" :disabled="acting" @click="confirmSkip = true">跳过接管</button>
          <button v-if="initialization?.status === 'analyzing' || isWaitingAnalysis" class="btn btn-ghost btn-sm" :disabled="acting" @click="cancel">取消分析</button>
          <button v-if="isQuickQueued" class="btn btn-ghost btn-sm" :disabled="acting" @click="cancel">取消本次处理</button>
          <button v-if="canRestart && !needsRestart" class="btn btn-info btn-sm" :disabled="acting" @click="confirmReanalysis = true">重新分析当前方案</button>
        </div>
      </header>

      <details v-if="reviewExpanded && initialization?.matchingConfig" class="matching-snapshot">
        <summary>匹配规则与本次分析设置</summary>
        <div class="matching-snapshot__heading"><div><strong>本次分析：{{ initialization.matchingConfig.config.enabled ? '增强匹配（实验）' : '标准匹配' }}</strong><p>结果按这份设置生成，之后修改设置不会影响它。</p></div>
        <NuxtLink class="btn btn-ghost btn-sm" :to="{ path: '/config', query: { tab: 'matching', source: sourceId } }">调整匹配设置</NuxtLink></div>
        <details><summary>查看本次使用的设置</summary><pre>{{ JSON.stringify(initialization.matchingConfig, null, 2) }}</pre><small>分析时间：{{ initialization.analyzedAt }} · 设置编号：{{ initialization.matchingConfigFingerprint?.slice(0, 12) }}</small></details>
        <p v-for="warning in initialization.matchingConfig.musicBrainz?.warnings ?? []" :key="warning" role="status">{{ warning }}</p>
      </details>
      </div>
      <aside v-if="initialization?.status === 'awaiting_review'" class="source-adoption__tools">
        <div class="source-adoption__tools-row"><AppIcon name="info" :size="17" /><strong>{{ initialization.quickStatus === 'queued' ? '已安排，后台将继续处理' : '可以直接开始，也可以自行调整' }}</strong><button v-if="isEditable" class="btn btn-primary" :disabled="acting" @click="requestCommit">开始下载并同步</button><button class="btn btn-ghost" :aria-expanded="reviewExpanded" @click="reviewExpanded = !reviewExpanded">{{ reviewExpanded ? '收起详细安排' : '查看和调整安排' }}</button><button v-if="isEditable" class="btn btn-ghost" :disabled="acting" @click="quickOpen = true">按分数线重新安排</button></div>
        <p>{{ initialization.autoProcess ? '直接开始会采用当前排序的第一个候选，没有候选的才下载。' : '审批初始化按推荐规则准备草案，采用首候选可在下方批量操作栏统一选择。' }}你的手动选择会保留。</p>
        <button v-if="initialization.autoProcess && isEditable && (initialization.quickStatus === 'failed' || initialization.quickStatus === 'cancelled')" class="btn btn-secondary btn-sm" :disabled="acting" @click="retryAutomatic">重新准备并开始</button>
        <p v-if="initialization.quickStatus === 'queued'" role="status">歌曲安排已提交，页面会自动更新处理进度；取消后保留当前选择。</p>
      </aside>
      <SourceInitializationQuickPlan
        v-if="initialization?.status === 'awaiting_review'"
        :visible="quickOpen"
        :source-id="sourceId"
        :initialization="initialization"
        :busy="acting"
        :disabled="!isEditable"
        @close="quickOpen = false"
        @request-commit="quickOpen = false; requestCommit()"
        @changed="onQuickChanged"
        @submitted="emit('submitted')"
      />
      <SourceInitializationReanalysis v-if="reanalysisOpened && initialization" :key="initialization.id" :visible="confirmReanalysis" :submit-error="error" :source-id="sourceId" :initialization="initialization" :busy="acting" @confirm="restartFromDrawer" @cancel="confirmReanalysis = false" />
      <nav v-if="canReview && reviewExpanded" class="source-adoption__groups" aria-label="候选分组">
        <button v-for="group in reviewGroups" :key="group.value" class="btn btn-ghost btn-sm source-adoption__group" :data-tone="group.value" :aria-pressed="group.value === activeGroup" @click="tier = group.value; reloadItems(1)"><AppIcon :name="group.value === 'recommended' || group.value === 'preserved' ? 'checkCircle' : group.value === 'conflict' ? 'warn' : group.value === 'needs_review' ? 'search' : 'music'" :size="14" />{{ group.label }} <span>{{ group.count }}</span></button>
      </nav>

      <p v-if="(error || itemsError) && !confirmReanalysis" class="source-adoption__error" role="alert">{{ error || itemsError }}</p>
      <p v-if="initialization?.error" class="source-adoption__error" role="alert">{{ initialization.error }}</p>
      <div v-if="isAnalyzing || isWaitingAnalysis" class="section-card source-adoption__progress"><AppIcon name="loader" :size="18" class="animate-spin" /><div><strong>{{ isWaitingAnalysis ? '分析已排队，等待后台处理' : '正在扫描 Plex 音乐库，生成候选' }}</strong><p>{{ isWaitingAnalysis ? '请求已收到，页面会自动刷新进度。' : '可以离开此页面，任务会在后台继续。' }}</p></div></div>

      <div v-if="needsRestart" class="section-card source-adoption__incompatible"><strong>匹配设置已更新</strong><p>当前结果由旧设置生成，可以查看，但不能修改或提交；请重新分析后再继续。</p><button class="btn btn-primary btn-sm" :disabled="acting" @click="confirmReanalysis = true"><AppIcon name="refresh" :size="16" />重新分析当前方案</button></div>
      <aside v-if="libraryChanged && !needsRestart" class="section-card source-adoption__library-change" role="status"><AppIcon name="info" :size="18" /><div><strong>Plex 音乐库有变化</strong><p>音乐库在分析后发生变化，当前选择已保留，可以重新分析查看最新候选。</p></div><button class="btn btn-info btn-sm" :disabled="acting" @click="confirmReanalysis = true">重新分析当前方案</button></aside>

      <button v-if="initialization?.status === 'completed'" class="btn btn-ghost btn-sm" :aria-expanded="reviewExpanded" @click="reviewExpanded = !reviewExpanded">{{ reviewExpanded ? '收起歌曲安排' : '查看本次歌曲安排' }}</button>

      <SourceInitializationReview
        v-if="canReview && reviewExpanded"
        :items="result.items"
        :total="result.total"
        :page="result.page"
        :page-size="result.pageSize"
        :selected-count="selectedCount"
        :all-matching-selected="allMatchingSelected"
        :can-select-all-matching="canSelectAllMatching"
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
        @adopt-first="adoptFirstSelected"
        @open-evidence="openDrawer"
        @change-page="changePage"
      ><template #actions><button v-if="isEditable && initialization?.highConfidenceItems" class="btn btn-ghost btn-sm" :disabled="acting" @click="confirmHighConfidence = true">采用推荐候选（{{ initialization.highConfidenceItems }} 首）</button></template></SourceInitializationReview>

      <SourceInitializationSummary v-if="isCompatibleReview && initialization?.status === 'awaiting_review' && initialization" :initialization="initialization" :acting="acting" :can-commit="isEditable" @commit="requestCommit" />
      <SourceInitializationEvidence :error="error" :item="drawerItem" :search-results="searchResults" :acting="acting" @close="drawerItem = null" @search="searchPlex" @adopt="adoptCurrentCandidate" @choose="chooseCandidate" @confirm-shared="confirmSharedMedia" />

      <ConfirmDialog :visible="confirmCommit" :title="`还有 ${initialization?.deferredItems || 0} 首不会加入 Plex`" confirm-label="采用首个候选并开始" cancel-label="返回调整" :busy="acting" @confirm="arrangeAndSubmit" @cancel="confirmCommit = false">
        <p class="text-sm text-muted">采用暂缓歌曲当前排序的第一个候选，没有候选的安排下载。艺人名称、版本或共享媒体的差异只作提示，不会阻止你采用；也可以继续暂缓。</p>
        <ul class="source-adoption__deferred"><li v-for="group in deferredGroups" :key="group.key"><strong>{{ group.label }} · {{ group.count }} 首</strong><p>{{ group.explanation }}</p></li></ul>
        <button class="btn btn-ghost btn-sm" :disabled="acting" @click="submitCommit(true)">仍跳过这 {{ initialization?.deferredItems || 0 }} 首，只同步其余歌曲</button>
      </ConfirmDialog>
      <ConfirmDialog :visible="confirmHighConfidence" title="批量设为使用 Plex" :message="`把 ${initialization?.highConfidenceItems || 0} 首推荐匹配候选改为“使用 Plex”。只修改当前选择，点“开始下载并同步”后才会生效。`" confirm-label="确认修改" :busy="acting" @confirm="confirmHighConfidence = false; adoptAllHighConfidence()" @cancel="confirmHighConfidence = false" />
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
const emit = defineEmits<{ changed: []; submitted: []; media: []; pendingChange: [state: { pending: boolean; analyzing: boolean }] }>()
const applicable = computed(() => props.sourceType === 'playlist')
const confirmCommit = ref(false)
const confirmSkip = ref(false)
const confirmReanalysis = ref(false)
const reanalysisOpened = ref(false)
const quickOpen = ref(false)
const reviewExpanded = ref(true)
watch(confirmReanalysis, value => { if (value) reanalysisOpened.value = true })
async function restartFromDrawer() { await restart(); if (!error.value) confirmReanalysis.value = false }
async function submitCommit(confirmDeferred = false): Promise<void> { confirmCommit.value = false; if (await commit(confirmDeferred)) emit('submitted') }
function requestCommit(): void { if (initialization.value?.deferredItems) confirmCommit.value = true; else void submitCommit() }
async function arrangeAndSubmit(): Promise<void> { if (await arrange('deferred')) await submitCommit() }
async function retryAutomatic(): Promise<void> { if (await arrange('default') && !isQuickQueued.value) requestCommit() }
const confirmHighConfidence = ref(false)

const state = useSourceInitialization({ sourceId: props.sourceId, onChanged: () => emit('changed') })
const { initialization, processing, deferredGroups, libraryChanged, loading, loadingItems, acting, error, itemsError, result, tier, decision, search, selectedCount, allMatchingSelected, canSelectAllMatching, selectionCategoryLabel, isSelected, selectAllMatching, clearSelection, drawerItem, searchResults, isAnalyzing, isWaitingAnalysis, isEditable, isQuickQueued, needsRestart, canReview, tierLabel, load, reloadItems, start, cancel, skip, restart, decideOne, decideSelected, adoptAllHighConfidence, toggle, togglePage, onSearch, clearFilters, changePage, openDrawer, searchPlex, chooseCandidate, confirmSharedMedia, commit, arrange, adoptFirstSelected } = state
watch(() => initialization.value?.id, () => { reviewExpanded.value = true })
watch(() => [initialization.value?.status, initialization.value?.autoProcess, isQuickQueued.value, processing.value?.active], () => {
  const automaticAnalysis = initialization.value?.autoProcess && (isAnalyzing.value || isWaitingAnalysis.value)
  const pending = Boolean(initialization.value && !automaticAnalysis && !isQuickQueued.value && !processing.value?.active && ['pending', 'analyzing', 'awaiting_review'].includes(initialization.value.status))
  emit('pendingChange', { pending, analyzing: isAnalyzing.value || isWaitingAnalysis.value })
}, { immediate: true })
watch(() => processing.value?.status, () => emit('changed'))

const tierOptions = [
  ['strong_id', '明确匹配'], ['high_confidence', '推荐匹配'], ['possible', '需要核对'], ['ambiguous', '多个相近结果'],
  ['unmatched', '未匹配'], ['metadata_missing', '信息不完整'], ['conflict', '冲突'], ['preserved', '已确认文件'],
].map(([value, label]) => ({ value, label }))

const canStart = computed(() => !initialization.value || (['pending', 'failed', 'cancelled'].includes(initialization.value.status) && !isWaitingAnalysis.value))
const canRestart = computed(() => Boolean(initialization.value && !isQuickQueued.value && !processing.value?.active && ['awaiting_review', 'completed', 'skipped'].includes(initialization.value.status)))
const isCompatibleReview = computed(() => Boolean(initialization.value && initialization.value.rulesCompatible))
const statusLabel = computed(() => ({ pending: '等待准备', analyzing: '分析中', awaiting_review: '歌曲已安排', applying: '应用安排中', completed: '安排已应用', failed: '准备失败', cancelled: '已取消', skipped: '已跳过' } as Record<string, string>)[initialization.value?.status || 'pending'] || '等待准备')
const statusTone = computed(() => initialization.value?.status === 'completed' ? 'ok' : initialization.value?.status === 'failed' ? 'error' : isAnalyzing.value ? 'running' : 'warning')
const activeGroup = computed(() => evidenceGroups.find(group => group.value === tier.value || group.members.includes(tier.value))?.value ?? '')
const reviewGroups = computed(() => {
  const item = initialization.value
  return [{ value: '', label: '全部', count: item?.totalItems ?? 0 }, ...evidenceGroups.map((group, index) => ({ ...group, count: [
    (item?.strongItems ?? 0) + (item?.highConfidenceItems ?? 0),
    (item?.possibleItems ?? 0) + (item?.ambiguousItems ?? 0),
    item?.unmatchedItems ?? 0, item?.conflictItems ?? 0, item?.preservedItems ?? 0,
  ][index] }))]
})

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
.source-adoption__deferred{display:grid;gap:var(--space-3);margin:var(--space-4) 0;padding-left:var(--space-4)}.source-adoption__deferred p{margin:var(--space-1) 0 0;color:var(--text-secondary);font-size:var(--text-sm)}
</style>
