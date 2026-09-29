<template>
  <section class="source-adoption" :aria-busy="loading">
    <div v-if="!applicable" class="section-card p-8"><EmptyState title="已保存专辑无需首次媒体接管" description="专辑继续使用现有下载与 Plex 导入流程。" /></div>
    <template v-else>
      <header class="section-card source-adoption__hero">
        <div><h2>首次媒体接管</h2><p>先读取网易云和 Plex 生成方案；确认前不会下载，也不会修改 Plex。</p></div>
        <div class="source-adoption__actions">
          <StatusBadge :status="statusTone" :label="statusLabel" />
          <button v-if="canStart" class="btn btn-primary btn-sm" :disabled="acting" @click="start"><AppIcon name="search" :size="14" />开始分析</button>
          <button v-if="initialization?.status === 'pending' && !isWaitingAnalysis" class="btn btn-ghost btn-sm" :disabled="acting" @click="confirmSkip = true">跳过接管</button>
          <button v-if="isAnalyzing || isWaitingAnalysis" class="btn btn-secondary btn-sm" :disabled="acting" @click="cancel">取消分析</button>
          <button v-if="canRestart && !needsRestart" class="btn btn-secondary btn-sm" :disabled="acting" @click="confirmReanalysis = true">{{ needsRestart ? '规则已更新，重新分析' : '放弃方案并重新分析' }}</button>
        </div>
      </header>

      <section v-if="initialization?.matchingConfig" class="section-card matching-snapshot">
        <div><strong>本草案使用{{ initialization.matchingConfig.config.enabled ? '增强' : '标准' }}匹配</strong><p>参数与分析结果已一起保存。修改设置不会改变当前草案。</p></div>
        <NuxtLink class="btn btn-secondary btn-sm" :to="{ path: '/config', query: { tab: 'matching', source: sourceId } }">初始化匹配设置</NuxtLink>
        <details><summary>查看分析参数</summary><pre>{{ JSON.stringify(initialization.matchingConfig, null, 2) }}</pre><small>分析时间：{{ initialization.analyzedAt }} · 参数指纹：{{ initialization.matchingConfigFingerprint?.slice(0, 12) }}</small></details>
        <p v-for="warning in initialization.matchingConfig.musicBrainz?.warnings ?? []" :key="warning" role="status">{{ warning }}</p>
      </section>
      <SourceInitializationReanalysis v-if="confirmReanalysis && initialization" :source-id="sourceId" :initialization="initialization" :busy="acting" @confirm="confirmReanalysis = false; restart()" @cancel="confirmReanalysis = false" />

      <div v-if="initialization" class="source-adoption__steps" aria-label="接管阶段"><div v-for="(step, index) in steps" :key="step.label" :class="{ 'is-current': step.current, 'is-done': step.done }"><span>{{ index + 1 }}</span><strong>{{ step.label }}</strong></div></div>
      <div v-if="initialization" class="source-adoption__metrics"><article v-for="metric in metrics" :key="metric.label" class="section-card"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong><small>{{ metric.hint }}</small></article><div class="source-adoption__evidence-counts" aria-label="候选证据分布"><span v-for="metric in evidenceMetrics" :key="metric.label">{{ metric.label }} <b>{{ metric.value }}</b></span></div></div>
      <div v-if="isCompatibleReview && initialization?.highConfidenceItems" class="section-card source-adoption__quick-action"><div><strong>批量处理高置信候选</strong><p>仅修改当前接管草案，不会立即写入身份或下载媒体。</p></div><button class="btn btn-secondary btn-sm" :disabled="acting" @click="confirmHighConfidence = true">将 {{ initialization.highConfidenceItems }} 首设为使用 Plex</button></div>

      <p v-if="error || itemsError" class="source-adoption__error" role="alert">{{ error || itemsError }}</p>
      <div v-if="isAnalyzing || isWaitingAnalysis" class="section-card source-adoption__progress"><AppIcon name="loader" :size="18" class="animate-spin" /><div><strong>{{ isWaitingAnalysis ? '分析已排队，等待后台处理' : '正在构建 Plex 全库候选索引' }}</strong><p>{{ isWaitingAnalysis ? '请求已接受，页面会自动刷新分析进度。' : '可离开此页面，任务会在后台继续。' }}</p></div></div>

      <div v-if="needsRestart" class="section-card source-adoption__incompatible"><strong>接管规则已更新</strong><p>当前方案使用旧版匹配规则，仍可查看审核快照，但必须重新分析后才能编辑或提交。现有方案不会被应用。</p><button class="btn btn-primary btn-sm" :disabled="acting" @click="confirmReanalysis = true"><AppIcon name="refresh" :size="16" />重新分析当前歌单</button></div>

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
        @reload="reloadItems()"
        @toggle="toggle"
        @toggle-page="togglePage"
        @decide="handleReviewDecision"
        @open-evidence="openDrawer"
        @change-page="changePage"
      />

      <SourceInitializationSummary v-if="isCompatibleReview && initialization?.status === 'awaiting_review' && initialization" :initialization="initialization" :queue-depth="queueDepth" :download-concurrency="downloadConcurrency" :acting="acting" :can-commit="isEditable" @commit="confirmCommit = true" />
      <SourceInitializationEvidence :item="drawerItem" :search-results="searchResults" :acting="acting" @close="drawerItem = null" @search="searchPlex" @choose="chooseCandidate" />

      <ConfirmDialog :visible="confirmCommit" title="提交首次媒体接管方案" :message="commitMessage" confirm-label="确认并应用" :busy="acting" @confirm="confirmCommit = false; commit()" @cancel="confirmCommit = false" />
      <ConfirmDialog :visible="confirmHighConfidence" title="批量使用高置信 Plex 候选" :message="`将 ${initialization?.highConfidenceItems || 0} 首高置信候选的草案决定改为“使用 Plex”。这不会立即写入身份，仍需最终提交。`" confirm-label="更新草案" :busy="acting" @confirm="confirmHighConfidence = false; adoptAllHighConfidence()" @cancel="confirmHighConfidence = false" />
      <ConfirmDialog :visible="confirmSkip" title="跳过首次媒体接管" message="跳过后普通同步会立即恢复当前未验证媒体策略，可能排队下载大量歌曲。确定继续吗？" confirm-label="确认跳过" :busy="acting" @confirm="confirmSkip = false; skip()" @cancel="confirmSkip = false" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { InitializationDecision } from '../../composables/useSourceInitialization'
import { useSourceInitialization } from '../../composables/useSourceInitialization'

const props = defineProps<{ sourceId: string; sourceType: 'playlist' | 'album' }>()
const emit = defineEmits<{ changed: [] }>()
const applicable = computed(() => props.sourceType === 'playlist')
const confirmCommit = ref(false)
const confirmSkip = ref(false)
const confirmReanalysis = ref(false)
const confirmHighConfidence = ref(false)

const state = useSourceInitialization({ sourceId: props.sourceId, onChanged: () => emit('changed') })
const { initialization, downloadConcurrency, queueDepth, loading, loadingItems, acting, error, itemsError, result, tier, decision, search, selected, drawerItem, searchResults, isAnalyzing, isWaitingAnalysis, isEditable, needsRestart, canReview, tierLabel, reloadItems, start, cancel, skip, restart, decideOne, decideSelected, adoptAllHighConfidence, toggle, togglePage, onSearch, clearFilters, changePage, openDrawer, searchPlex, chooseCandidate, commit } = state

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
  { label: '计划下载', value: initialization.value?.downloadItems || 0, hint: '提交方案后处理' },
])
const evidenceMetrics = computed(() => [
  { label: '强身份', value: initialization.value?.strongItems || 0, hint: '默认预选' }, { label: '高置信', value: initialization.value?.highConfidenceItems || 0, hint: '可批量选择' },
  { label: '可能候选', value: initialization.value?.possibleItems || 0, hint: '逐项确认' }, { label: '歧义', value: initialization.value?.ambiguousItems || 0, hint: '需要检查' },
  { label: '未匹配', value: initialization.value?.unmatchedItems || 0, hint: '下载或暂缓' },
])
const steps = computed(() => ['分析候选', '确认方案', '应用决定', '普通同步'].map((label, index) => {
  const rank = ({ pending: 0, analyzing: 0, awaiting_review: 1, applying: 2, completed: 3 } as Record<string, number>)[initialization.value?.status || 'pending'] ?? 0
  return { label, current: index === rank, done: index < rank }
}))
const commitMessage = computed(() => `将接管 ${initialization.value?.adoptItems || 0} 首、计划下载 ${initialization.value?.downloadItems || 0} 首、暂缓 ${initialization.value?.deferredItems || 0} 首、冲突 ${initialization.value?.conflictItems || 0} 首。后续下载并发为 ${downloadConcurrency.value}；确认前没有产生下载或 Plex 修改。`)

function handleReviewDecision(songId: number, value: InitializationDecision): void {
  if (songId === 0) void decideSelected(value)
  else void decideOne(songId, value)
}
</script>

<style scoped>
@import '~/assets/css/components/source-initialization-shared.css';
@import '~/assets/css/components/source-initialization-panel.css';
.matching-snapshot { display: grid; gap: var(--space-3); }
.matching-snapshot pre { overflow: auto; max-height: 20rem; font-size: var(--text-xs); }
.matching-snapshot small { overflow-wrap: anywhere; }
</style>
