<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import type { SourceInitializationSummary } from '../../server/lib/source-initialization/types'
import type { AppConfig } from '../../server/lib/config/types'
import { DEFAULT_INITIALIZATION_MATCHING, type MatchingPreviewResult } from '../../shared/initialization-matching'
const props = defineProps<{ visible: boolean; submitError?: string; sourceId: string; initialization: SourceInitializationSummary; busy: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const api = useApi()
const loading = ref(true), error = ref(''), preview = ref<MatchingPreviewResult | null>(null)
let comparisonRequest = 0
async function compare() {
  const request = ++comparisonRequest
  loading.value = true; error.value = ''
  try {
    const config = await api.get<AppConfig>('/config')
    const result = await api.post<MatchingPreviewResult>('/initialization-matching/preview', {
      sourceId: props.sourceId, initializationId: props.initialization.id,
      config: config.initializationMatching ?? DEFAULT_INITIALIZATION_MATCHING,
    })
    if (request === comparisonRequest) preview.value = result
  } catch (err) { if (request === comparisonRequest) error.value = err instanceof Error ? err.message : '无法读取比较结果' }
  finally { if (request === comparisonRequest) loading.value = false }
}
const changed = computed(() => preview.value?.items.filter(item => item.change !== 'unchanged') ?? [])
watch(() => props.visible, visible => { if (visible) void compare() }, { immediate: true })
onBeforeUnmount(() => { comparisonRequest++ })
</script>

<template>
  <AppDrawer :visible="visible" title="重新分析" wide :busy="busy" @close="emit('cancel')">
  <section class="matching-reanalysis" aria-label="重新分析前比较" :aria-busy="loading">
    <header class="matching-reanalysis__heading">
      <AppIcon name="refresh" :size="18" />
      <div><h3>按当前设置重新分析</h3><p>先比较参数变化，再决定是否创建新草案。</p></div>
    </header>
    <div class="matching-reanalysis__notice">
      <strong>重新生成接管草案</strong>
      <p>已确认的媒体关联会保留；旧草案中未提交的选择需要重新确认。</p>
    </div>
    <p v-if="initialization.matchingConfig && !initialization.rulesCompatible" class="matching-reanalysis__context">旧草案的算法版本已变化。下方使用当前算法比较两组参数，不能精确重放旧算法结果。</p>
    <p v-if="!initialization.matchingConfig" class="matching-reanalysis__context">旧草案未记录参数快照；下方使用当前保存参数作基线，不能复现旧规则差异。</p>
    <div v-if="loading" class="matching-reanalysis__feedback" role="status"><AppIcon name="loader" :size="16" class="animate-spin" />正在用同一份最新数据比较草案参数与当前设置…</div>
    <div v-if="error" class="matching-reanalysis__feedback matching-reanalysis__error" role="alert"><span>{{ error }}</span><button class="btn btn-secondary btn-sm" @click="compare">重试比较</button></div>
    <template v-if="preview && !loading && !error">
      <p v-for="warning in preview.musicBrainz?.warnings ?? []" :key="warning" role="status" class="matching-reanalysis__context">{{ warning }}</p>
      <div class="matching-reanalysis__comparison" aria-label="同快照比较结果">
        <div><span>可推荐</span><p><span>{{ preview.before.recommended }}</span><AppIcon name="arrowRight" :size="16" /><strong>{{ preview.after.recommended }}</strong></p><small>草案参数 → 当前设置</small></div>
        <div><span>无候选</span><p><span>{{ preview.before.unmatched }}</span><AppIcon name="arrowRight" :size="16" /><strong>{{ preview.after.unmatched }}</strong></p><small>草案参数 → 当前设置</small></div>
        <div><span>分类或候选变化</span><p><strong>{{ changed.length }}</strong><small>首</small></p><small>基于同一份最新数据</small></div>
      </div>
      <details v-if="changed.length" class="matching-reanalysis__samples"><summary>查看变化样本（前 20 首）</summary><ul><li v-for="item in changed.slice(0, 20)" :key="item.songId"><strong>{{ item.title }}</strong><p>{{ item.reasons.join('；') }}<span v-if="item.conflicts.length">；{{ item.conflicts.join('；') }}</span></p></li></ul></details>
      <p v-else class="matching-reanalysis__context">本次比较未发现分类或候选变化。</p>
      <p class="matching-reanalysis__context">这是比较预览；确认后后台会重新读取数据并生成新草案。</p>
    </template>
  </section>
  <template #footer>
    <p v-if="submitError" class="matching-reanalysis__error" role="alert">{{ submitError }}</p>
    <div class="matching-reanalysis__actions">
      <button class="btn btn-primary" :disabled="busy || loading || !preview || !!error" @click="emit('confirm')">确认创建新草案</button>
      <button class="btn btn-secondary" :disabled="busy" @click="emit('cancel')">保留当前草案</button>
      <NuxtLink class="btn btn-ghost" :to="{ path: '/config', query: { tab: 'matching', source: sourceId } }">调整匹配规则</NuxtLink>
    </div>
  </template>
  </AppDrawer>
</template>
<style scoped>
.matching-reanalysis { min-width: 0; padding: var(--space-4); display: grid; gap: var(--space-4); font-size: var(--text-sm); }
.matching-reanalysis p { margin: 0; overflow-wrap: anywhere; }
.matching-reanalysis__heading { display: flex; align-items: flex-start; gap: var(--space-3); }
.matching-reanalysis__heading > svg { margin-top: var(--space-1); color: var(--accent); flex-shrink: 0; }
.matching-reanalysis__heading h3 { margin: 0 0 var(--space-1); font-size: var(--text-base); font-weight: var(--font-weight-bold); }
.matching-reanalysis__heading p, .matching-reanalysis__context { color: var(--text-secondary); font-size: var(--text-xs); line-height: 1.6; }
.matching-reanalysis__notice { padding: var(--space-3) var(--space-4); border-left: 3px solid var(--warning); background: var(--warning-soft); border-radius: var(--radius-sm); }
.matching-reanalysis__notice strong { display: block; margin-bottom: var(--space-1); font-size: var(--text-sm); }
.matching-reanalysis__notice p { color: var(--text-secondary); font-size: var(--text-xs); }
.matching-reanalysis__comparison { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--border-primary); border-radius: var(--radius-md); }
.matching-reanalysis__comparison > div { min-width: 0; padding: var(--space-4); }
.matching-reanalysis__comparison > div + div { border-left: 1px solid var(--border-primary); }
.matching-reanalysis__comparison > div > span, .matching-reanalysis__comparison small { color: var(--text-secondary); font-size: var(--text-xs); }
.matching-reanalysis__comparison p { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-2) 0; font-size: var(--text-lg); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
.matching-reanalysis__comparison p > span, .matching-reanalysis__comparison svg { color: var(--text-tertiary); }
.matching-reanalysis__comparison strong { font-weight: var(--font-weight-bold); }
.matching-reanalysis__samples { min-width: 0; }
.matching-reanalysis__samples summary { width: fit-content; cursor: pointer; color: var(--text-secondary); font-size: var(--text-xs); }
.matching-reanalysis__samples ul { list-style: none; padding: 0; margin: var(--space-3) 0 0; max-height: 18rem; overflow: auto; }
.matching-reanalysis__samples li { padding: var(--space-3) 0; border-bottom: 1px solid var(--border-primary); overflow-wrap: anywhere; }
.matching-reanalysis__samples li p { color: var(--text-secondary); font-size: var(--text-xs); margin-top: var(--space-1); }
.matching-reanalysis__feedback { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-3) 0; color: var(--text-secondary); }
.matching-reanalysis__error { color: var(--danger); }
.matching-reanalysis__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); border-top: 1px solid var(--border-primary); padding-top: var(--space-4); }
@media (max-width: 640px) {
  .matching-reanalysis__comparison { grid-template-columns: 1fr; }
  .matching-reanalysis__comparison > div + div { border-left: 0; border-top: 1px solid var(--border-primary); }
  .matching-reanalysis__comparison > div { padding: var(--space-3); }
}
</style>
