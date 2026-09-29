<script setup lang="ts">
import type { SourceInitializationSummary } from '../../server/lib/source-initialization/types'
import type { AppConfig } from '../../server/lib/config/types'
import { DEFAULT_INITIALIZATION_MATCHING, type MatchingPreviewResult } from '../../shared/initialization-matching'
const props = defineProps<{ sourceId: string; initialization: SourceInitializationSummary; busy: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const api = useApi()
const loading = ref(true), error = ref(''), preview = ref<MatchingPreviewResult | null>(null)
async function compare() {
  loading.value = true; error.value = ''
  try {
    const config = await api.get<AppConfig>('/config')
    preview.value = await api.post<MatchingPreviewResult>('/initialization-matching/preview', {
      sourceId: props.sourceId, initializationId: props.initialization.id,
      config: config.initializationMatching ?? DEFAULT_INITIALIZATION_MATCHING,
    })
  } catch (err) { error.value = err instanceof Error ? err.message : '无法读取比较结果' }
  finally { loading.value = false }
}
const changed = computed(() => preview.value?.items.filter(item => item.change !== 'unchanged') ?? [])
onMounted(compare)
</script>

<template>
  <section class="section-card matching-reanalysis" aria-label="重新分析前比较" :aria-busy="loading">
    <h3>按当前设置重新分析</h3>
    <p>旧草案保留为历史记录。当前的 {{ initialization.adoptItems }} 首接管选择和 {{ initialization.downloadItems }} 首下载选择不会自动转入新草案，需要重新确认。</p>
    <p v-if="initialization.matchingConfig && !initialization.rulesCompatible">旧草案的算法版本已变化。下方使用当前算法比较两组参数，不能精确重放旧算法结果。</p>
    <p v-if="!initialization.matchingConfig">旧草案未记录参数快照；下方使用当前保存参数作基线，不能复现旧规则差异。</p>
    <p v-if="loading" role="status">正在用同一份最新数据比较草案参数与当前设置…</p>
    <p v-if="error" role="alert">{{ error }} <button class="btn btn-secondary btn-sm" @click="compare">重试比较</button></p>
    <template v-if="preview && !loading">
      <p v-for="warning in preview.musicBrainz?.warnings ?? []" :key="warning" role="status">{{ warning }}</p>
      <p>同快照比较：可推荐 {{ preview.before.recommended }} → {{ preview.after.recommended }}；无候选 {{ preview.before.unmatched }} → {{ preview.after.unmatched }}；共 {{ changed.length }} 首分类或候选变化。</p>
      <details v-if="changed.length"><summary>查看变化样本（前 20 首）</summary><ul><li v-for="item in changed.slice(0, 20)" :key="item.songId"><strong>{{ item.title }}</strong>：{{ item.reasons.join('；') }}<span v-if="item.conflicts.length">；{{ item.conflicts.join('；') }}</span></li></ul></details>
      <p>这是比较预览；确认后后台会重新读取数据并生成新草案。</p>
    </template>
    <div class="matching-reanalysis__actions">
      <button class="btn btn-primary" :disabled="busy || loading || !preview || !!error" @click="emit('confirm')">确认创建新草案</button>
      <button class="btn btn-secondary" :disabled="busy" @click="emit('cancel')">保留当前草案</button>
      <NuxtLink class="btn btn-ghost" :to="{ path: '/config', query: { tab: 'matching', source: sourceId } }">调整匹配规则</NuxtLink>
    </div>
  </section>
</template>
<style scoped>
.matching-reanalysis { display: grid; gap: var(--space-3); }
.matching-reanalysis p, .matching-reanalysis li { color: var(--text-secondary); overflow-wrap: anywhere; }
.matching-reanalysis ul { padding-inline-start: var(--space-5); }
.matching-reanalysis__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
