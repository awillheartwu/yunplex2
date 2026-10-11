<template>
  <section class="matching-preview" aria-labelledby="matching-preview-title">
    <div class="matching-preview__header">
      <div>
        <h3 id="matching-preview-title" class="type-h3">只读匹配预览</h3>
        <p>选择一个同步源后生成候选规划。预览不会下载、绑定媒体或修改 Plex。</p>
      </div>
      <NuxtLink v-if="sourceId" class="btn btn-secondary btn-sm" :to="{ path: `/sync-sources/${sourceId}`, query: { tab: 'initialization' } }">
        <AppIcon name="external" :size="14" />打开来源接管
      </NuxtLink>
    </div>

    <div class="matching-preview__controls">
      <div class="matching-preview__source">
        <span class="matching-preview__label">预览来源</span>
        <ListSelect
          v-model="sourceId"
          class="matching-preview__source-select"
          aria-label="预览来源"
          placeholder="选择歌单"
          :loading="sourcesLoading"
          :disabled="previewLoading"
          :options="sourceSelectOptions"
        />
      </div>
      <div class="matching-preview__actions">
        <button type="button" class="btn btn-primary" :disabled="!sourceId || previewLoading" @click="runPreview()">
          <AppIcon :name="previewLoading ? 'loader' : 'search'" :class="{ 'animate-spin': previewLoading }" :size="15" />
          {{ previewLoading ? '生成中…' : runLabel }}
        </button>
        <button type="button" class="btn btn-secondary" :disabled="!sourceId || previewLoading" @click="runPreview(true)">
          <AppIcon name="refresh" :size="15" />刷新快照
        </button>
      </div>
    </div>

    <div v-if="sourcesError" class="matching-preview__message matching-preview__message--error" role="alert">
      <AppIcon name="x" :size="15" />
      <span>来源列表加载失败：{{ sourcesError }}</span>
      <button type="button" class="btn btn-ghost btn-sm" @click="loadSources">重新加载</button>
    </div>
    <div v-else-if="sourcesLoading" class="matching-preview__message" role="status" aria-live="polite">正在加载来源列表…</div>
    <div v-if="previewError" class="matching-preview__message matching-preview__message--error" role="alert">
      <AppIcon name="x" :size="15" />
      <span>{{ previewError }}</span>
    </div>
    <div v-if="result && expired" class="matching-preview__message matching-preview__message--warning" role="status">
      <AppIcon name="warn" :size="15" />
      <span>这份预览快照已过期，结果不能继续作为当前比较依据。请点击“刷新快照”重新读取来源。</span>
    </div>
    <div v-if="result && stale && !expired" class="matching-preview__message matching-preview__message--warning" role="status">
      <AppIcon name="warn" :size="15" />
      <span>设置已修改，下面的结果仍来自上一次运行。重新预览会沿用同一个来源快照。</span>
    </div>

    <template v-if="result && !expired">
      <div v-if="result.musicBrainz" class="matching-preview__message" role="status">
        <div>MusicBrainz：查询 {{ result.musicBrainz.queried }} 位艺人，返回 {{ result.musicBrainz.groups.length }} 组无同名歧义的异名记录，{{ result.musicBrainz.skipped }} 位未查询。
          <p v-for="warning in result.musicBrainz.warnings" :key="warning">{{ warning }}</p>
          <details v-if="result.musicBrainz.groups.length"><summary>查看 MusicBrainz 证据</summary><ul><li v-for="group in result.musicBrainz.groups" :key="group.mbid">{{ group.name }}：{{ group.aliases.join('、') }} · MBID {{ group.mbid }} · 搜索分 {{ group.score }}</li></ul></details>
        </div>
      </div>
      <div class="matching-preview__meta">
        <span>{{ result.sourceName }} · {{ result.total }} 首歌曲 · Plex 音乐库 {{ result.trackCount }} 首</span>
          <span>快照于 {{ formatDate(result.capturedAt) }} 生成，20 分钟内有效</span>
      </div>
      <div class="matching-preview__counts" aria-label="匹配结果前后对比">
        <div class="matching-preview__count-column">
          <strong>快照基线</strong>
          <div class="matching-preview__count-grid">
            <span v-for="metric in countMetrics" :key="`before-${metric.key}`"><small>{{ metric.label }}</small><b>{{ result.before[metric.key] }}</b></span>
          </div>
        </div>
        <div class="matching-preview__count-column matching-preview__count-column--after">
          <strong>当前参数草稿</strong>
          <div class="matching-preview__count-grid">
            <span v-for="metric in countMetrics" :key="`after-${metric.key}`"><small>{{ metric.label }}</small><b>{{ result.after[metric.key] }}</b></span>
          </div>
        </div>
      </div>

      <div v-if="result.aliasSuggestions.length" class="matching-preview__suggestions" aria-labelledby="matching-suggestions-title">
        <div>
          <h4 id="matching-suggestions-title" class="type-h4">预览发现的别名建议</h4>
          <p>建议只来自本次只读预览。确认后会加入当前草稿，仍需在页底保存。</p>
        </div>
        <ul>
          <li v-for="suggestion in result.aliasSuggestions" :key="`${suggestion.name}-${suggestion.aliases.join('|')}`">
            <span><strong>{{ suggestion.name }}</strong> ← {{ suggestion.aliases.join('、') }}<small>{{ suggestion.count }} 次 · {{ suggestion.examples.join('、') }}</small></span>
            <button type="button" class="btn btn-ghost btn-sm" @click="$emit('use-alias-suggestion', suggestion)">加入艺人别名</button>
          </li>
        </ul>
      </div>

      <div class="matching-preview__results-head">
        <div>
          <h4 class="type-h4">逐首变化</h4>
          <p>展开条目查看规则理由、冲突和候选。没有任何外部写入动作。</p>
        </div>
      </div>
      <FilterBar
        :search="search"
        placeholder="搜索歌曲、艺人或候选"
        search-label="搜索预览结果"
        :active-count="changeFilter === 'changed' ? 1 : 0"
        :can-clear="Boolean(search) || changeFilter !== 'changed'"
        @update:search="search = $event"
        @clear="clearPreviewFilters"
      >
        <template #filters>
          <ListSelect v-model="changeFilter" class="matching-preview__filter" aria-label="预览结果筛选" :options="changeFilterOptions" />
        </template>
        <template #summary><span>显示 {{ filteredItems.length }} / {{ result?.items.length ?? 0 }} 首</span></template>
      </FilterBar>
      <div v-if="filteredItems.length" class="matching-preview__items">
        <article v-for="item in pagedItems" :key="item.songId" class="matching-preview__item">
          <div class="matching-preview__item-summary">
            <div>
              <strong>{{ item.title }}</strong>
              <span>{{ item.artists.join('、') || '未知艺人' }}</span>
            </div>
            <span class="matching-preview__change" :class="`matching-preview__change--${item.change}`">{{ changeLabel(item.change) }}</span>
          </div>
          <div class="matching-preview__transition"><span>{{ resolutionLabel(item.before) }}</span><AppIcon name="arrowRight" :size="14" /><span>{{ resolutionLabel(item.after) }}</span></div>
          <details>
            <summary>查看理由、冲突与候选</summary>
            <div class="matching-preview__details">
              <div><strong>理由</strong><ul><li v-for="reason in item.reasons" :key="reason">{{ reason }}</li><li v-if="!item.reasons.length">没有附加理由</li></ul></div>
              <div v-if="item.conflicts.length"><strong>冲突</strong><ul><li v-for="conflict in item.conflicts" :key="conflict">{{ conflict }}</li></ul></div>
              <div><strong>当前候选</strong><p v-if="item.candidate">{{ candidateText(item.candidate) }}</p><p v-else>没有确定候选</p></div>
              <div v-if="item.candidates.length"><strong>其他候选（{{ item.candidates.length }}）</strong><ul><li v-for="candidate in item.candidates" :key="candidate.ratingKey">{{ candidateText(candidate) }}</li></ul></div>
            </div>
          </details>
        </article>
      </div>
      <p v-else class="matching-preview__empty">当前筛选下没有结果。可以切换为“显示全部”或清空搜索。</p>
      <PageNavigator :page="page" :page-size="pageSize" :total="filteredItems.length" label="匹配预览" @change="page = $event" />
    </template>
    <p v-else-if="!previewLoading && !previewError && sourceId" class="matching-preview__empty">选择“生成预览”后，这里会显示前后计数和逐首候选变化。</p>
    <p v-else-if="!sourceId && !sourcesLoading && !sourcesError" class="matching-preview__empty">先选择一个来源。切换来源会清除旧快照和结果，避免误读。</p>
  </section>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import type { InitializationMatchingConfig, MatchingAlias, MatchingCounts, MatchingPreviewItem, MatchingPreviewResult } from '~~/shared/initialization-matching'

const props = defineProps<{ config: InitializationMatchingConfig }>()
defineEmits<{ 'use-alias-suggestion': [value: MatchingAlias & { count: number; examples: string[] }] }>()

const api = useApi()
const route = useRoute()
const sources = ref<PlaylistSource[]>([])
const sourcesLoading = ref(false)
const sourcesError = ref('')
const sourceId = ref('')
const previewLoading = ref(false)
const previewError = ref('')
const result = ref<MatchingPreviewResult | null>(null)
const snapshotId = ref<string | null>(null)
const runFingerprint = ref('')
const search = ref('')
const changeFilter = ref('changed')
const page = ref(1)
const pageSize = 12
const now = ref(Date.now())
let requestSequence = 0
let disposed = false
let expiryTimer: ReturnType<typeof setInterval> | undefined

const countMetrics: Array<{ key: keyof MatchingCounts; label: string }> = [
  { key: 'preserved', label: '保留' },
  { key: 'strong', label: '强匹配' },
  { key: 'recommended', label: '推荐' },
  { key: 'review', label: '待复核' },
  { key: 'duplicates', label: '重复' },
  { key: 'versionConflicts', label: '版本冲突' },
  { key: 'identityConflicts', label: '身份冲突' },
  { key: 'unmatched', label: '未匹配' },
  { key: 'metadataMissing', label: '缺少元数据' },
]

const changeFilterOptions = [
  { value: 'changed', label: '仅显示变化' },
  { value: 'all', label: '显示全部' },
]
const sourceSelectOptions = computed(() => sources.value.map(source => ({
  value: source.id,
  label: `${source.name || source.neteasePlaylistName} · ${source.trackCount} 首`,
})))

function clearPreviewFilters() {
  search.value = ''
  changeFilter.value = 'changed'
}

const expired = computed(() => Boolean(result.value && new Date(result.value.expiresAt).getTime() <= now.value))
const stale = computed(() => Boolean(result.value && runFingerprint.value !== configFingerprint(props.config)))
const runLabel = computed(() => result.value && snapshotId.value && !expired.value ? '按当前设置重新预览' : '生成预览')
const filteredItems = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return (result.value?.items ?? []).filter(item => {
    if (changeFilter.value === 'changed' && item.change === 'unchanged') return false
    if (!query) return true
    return itemSearchText(item).toLocaleLowerCase().includes(query)
  })
})
const pagedItems = computed(() => filteredItems.value.slice((page.value - 1) * pageSize, page.value * pageSize))

watch([search, changeFilter], () => { page.value = 1 })
watch(sourceId, () => {
  requestSequence += 1
  previewLoading.value = false
  snapshotId.value = null
  result.value = null
  runFingerprint.value = ''
  previewError.value = ''
  search.value = ''
  page.value = 1
})

onMounted(() => {
  void loadSources()
  expiryTimer = setInterval(() => { now.value = Date.now() }, 30_000)
})

onUnmounted(() => {
  disposed = true
  requestSequence += 1
  if (expiryTimer) clearInterval(expiryTimer)
})

async function loadSources() {
  sourcesLoading.value = true
  sourcesError.value = ''
  try {
    sources.value = (await api.get<PlaylistSource[]>('/playlist-sources')).filter(source => source.type === 'playlist')
    const requestedSource = typeof route.query.source === 'string' ? route.query.source : ''
    if (requestedSource && sources.value.some(source => source.id === requestedSource)) sourceId.value = requestedSource
  } catch (error) {
    sourcesError.value = error instanceof Error ? error.message : '请稍后重试'
  } finally {
    sourcesLoading.value = false
  }
}

async function runPreview(refresh = false) {
  if (!sourceId.value || previewLoading.value) return
  const requestId = ++requestSequence
  const sourceAtRequest = sourceId.value
  previewLoading.value = true
  previewError.value = ''
  if (refresh) {
    snapshotId.value = null
    result.value = null
    runFingerprint.value = ''
  }
  try {
    const body: { sourceId: string; config: InitializationMatchingConfig; snapshotId?: string } = {
      sourceId: sourceAtRequest,
      config: JSON.parse(JSON.stringify(props.config)) as InitializationMatchingConfig,
    }
    if (!refresh && snapshotId.value && !expired.value) body.snapshotId = snapshotId.value
    const next = await api.post<MatchingPreviewResult>('/initialization-matching/preview', body)
    if (disposed || requestId !== requestSequence || sourceId.value !== body.sourceId) return
    result.value = next
    snapshotId.value = next.snapshotId
    runFingerprint.value = configFingerprint(body.config)
    page.value = 1
  } catch (error) {
    if (!disposed && requestId === requestSequence) previewError.value = error instanceof Error ? error.message : '预览失败，请稍后重试'
  } finally {
    if (!disposed && requestId === requestSequence) previewLoading.value = false
  }
}

function configFingerprint(config: InitializationMatchingConfig): string {
  return JSON.stringify(config)
}

function itemSearchText(item: MatchingPreviewItem): string {
  return [item.title, ...item.artists, item.before, item.after, item.candidate?.title, item.candidate?.artist, item.candidate?.album, ...item.reasons, ...item.conflicts].filter(Boolean).join(' ')
}

function resolutionLabel(value: string): string {
  return ({
    preserved: '保留',
    strong_id: '强匹配',
    high_confidence: '推荐',
    possible: '待复核',
    ambiguous: '候选冲突',
    conflict: '身份冲突',
    duplicates: '重复候选',
    version_conflict: '版本冲突',
    unmatched: '未匹配',
    metadata_missing: '缺少元数据',
  } as Record<string, string>)[value] ?? value
}

function changeLabel(change: MatchingPreviewItem['change']): string {
  return ({ added: '新增匹配', downgraded: '降级', candidate_changed: '候选变化', changed: '规则变化', unchanged: '未变化' } as Record<MatchingPreviewItem['change'], string>)[change]
}

function candidateText(candidate: NonNullable<MatchingPreviewItem['candidate']>): string {
  return `${candidate.title} · ${candidate.artist} · ${candidate.album}${candidate.filePath ? ` · ${candidate.filePath}` : ''}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}
</script>

<style scoped>
.matching-preview {
  display: grid;
  gap: var(--space-4);
  padding-top: var(--space-2);
}

.matching-preview__header,
.matching-preview__controls,
.matching-preview__results-head,
.matching-preview__item-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.matching-preview h3,
.matching-preview h4,
.matching-preview p {
  margin: 0;
}

.matching-preview__header p,
.matching-preview__results-head p,
.matching-preview__suggestions p {
  margin-top: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
}

.matching-preview__controls {
  align-items: end;
  padding: var(--space-4);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.matching-preview__source {
  display: grid;
  flex: 1;
  min-width: 12rem;
  gap: var(--space-1_5);
}

.matching-preview__label {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}

.matching-preview__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.matching-preview__message {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--body-leading);
}

.matching-preview__message .btn {
  margin-left: auto;
  flex-shrink: 0;
}

.matching-preview__message--error {
  border-color: var(--danger-border);
  background: var(--danger-soft);
  color: var(--danger);
}

.matching-preview__message--warning {
  border-color: color-mix(in srgb, var(--warning) 40%, var(--border-primary));
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  color: var(--warning);
}

.matching-preview__meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.matching-preview__counts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.matching-preview__count-column {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.matching-preview__count-column--after {
  border-color: var(--accent);
  background: var(--accent-muted);
}

.matching-preview__count-column strong {
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.matching-preview__count-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
}

.matching-preview__count-grid span {
  display: grid;
  gap: var(--space-1);
}

.matching-preview__count-grid small {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.matching-preview__count-grid b {
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}

.matching-preview__suggestions {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--accent-muted);
}

.matching-preview__suggestions ul,
.matching-preview__details ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.matching-preview__suggestions li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-block: var(--space-2);
  border-top: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
}

.matching-preview__suggestions li > span {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.matching-preview__suggestions small {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.matching-preview__source-select,
.matching-preview__filter {
  min-width: 11rem;
}

.matching-preview__items {
  display: grid;
  gap: var(--space-2);
}

.matching-preview__item {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3_5);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.matching-preview__item-summary > div {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.matching-preview__item-summary strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.matching-preview__item-summary span:not(.matching-preview__change) {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.matching-preview__change {
  flex-shrink: 0;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.matching-preview__change--added,
.matching-preview__change--changed,
.matching-preview__change--candidate_changed {
  background: var(--accent-muted);
  color: var(--accent);
}

.matching-preview__change--downgraded {
  background: var(--warning-soft);
  color: var(--warning);
}

.matching-preview__transition {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.matching-preview__item details {
  border-top: 1px solid var(--border-primary);
  padding-top: var(--space-2);
}

.matching-preview__item summary {
  color: var(--accent);
  cursor: pointer;
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}

.matching-preview__details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  padding-top: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
}

.matching-preview__details strong {
  color: var(--text-primary);
}

.matching-preview__details li::before {
  content: '·';
  margin-right: var(--space-1);
  color: var(--accent);
}

.matching-preview__details p {
  margin-top: var(--space-1);
}

.matching-preview__empty {
  padding: var(--space-8) var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-align: center;
}

@media (max-width: 767px) {
  .matching-preview__header,
  .matching-preview__controls,
  .matching-preview__results-head {
    flex-direction: column;
  }

  .matching-preview__header .btn,
  .matching-preview__actions,
  .matching-preview__actions .btn {
    width: 100%;
  }

  .matching-preview__actions .btn {
    justify-content: center;
  }

  .matching-preview__counts,
  .matching-preview__details {
    grid-template-columns: 1fr;
  }

  .matching-preview__count-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .matching-preview__source-select,
  .matching-preview__filter {
    width: 100%;
    min-width: 0;
  }

  .matching-preview__suggestions li {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
