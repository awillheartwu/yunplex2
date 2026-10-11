<template>
  <section class="source-media" :class="{ 'source-media--mobile': mobile, 'source-media--orphaned': orphaned }" :aria-busy="loading">
    <header class="source-media__header">
      <div>
        <h2>{{ orphaned ? '孤立媒体关联' : '歌曲与媒体' }}</h2>
        <p>{{ orphaned ? '这些关联已不属于任何当前同步源，可在此检查或移除。' : '媒体关联按网易云歌曲 ID 全局生效；托管文件仍只按精确路径自动复用。' }}</p>
      </div>
      <NuxtLink v-if="!orphaned" class="btn btn-ghost btn-sm" to="/match-reviews">高级：孤立关联</NuxtLink>
    </header>

    <div v-if="orphaned || hasSnapshot !== false" class="source-media__filters">
      <label class="source-media__search">
        <AppIcon name="search" :size="14" />
        <input v-model="search" class="form-input" aria-label="搜索歌曲与媒体" :placeholder="orphaned ? '搜索歌曲 ID 或媒体路径' : '搜索歌曲、艺人、ID 或媒体路径'" @keyup.enter="applyFilters">
      </label>
      <ListSelect
        v-if="!orphaned"
        v-model="state"
        class="source-media__filter"
        aria-label="媒体状态"
        :options="mediaStateOptions"
        @change="exactState = ''; applyFilters()"
      />
      <ListSelect
        v-if="!orphaned && reasonOptions.length > 1"
        v-model="exactState"
        class="source-media__filter"
        aria-label="具体原因"
        :options="mediaReasonOptions"
        @change="applyFilters"
      />
      <button v-if="!orphaned" class="btn btn-secondary" type="button" :disabled="acting || loading" @click="validatePlex">
        <AppIcon :name="acting ? 'loader' : 'checkCircle'" :size="13" :class="{ 'animate-spin': acting }" />
        验证 Plex
      </button>
      <button class="btn btn-secondary" type="button" :disabled="loading" @click="load()">
        <AppIcon :name="loading ? 'loader' : 'refresh'" :size="13" :class="{ 'animate-spin': loading }" />
        刷新
      </button>
    </div>

    <label v-if="!orphaned && hasSnapshot !== false" class="source-media__reason"><input v-model="scoredOnly" type="checkbox" @change="applyFilters"> 仅看评分产生的关联</label>
    <p v-if="notice" class="source-media__notice" role="status">{{ notice }}</p>
    <p v-if="error" class="source-media__error" role="alert">{{ error }}</p>
    <div v-if="loading && !result.items.length" class="source-media__empty">加载媒体状态…</div>
    <div v-else-if="!result.items.length" class="source-media__empty">
      {{ orphaned ? '没有孤立媒体关联' : (state || search || scoredOnly ? '没有符合当前筛选条件的歌曲，请调整筛选。' : '当前来源还没有歌曲快照，请先完成首次媒体接管（如需要），再同步一次。') }}
      <button v-if="!orphaned && hasSnapshot === false" class="btn btn-secondary btn-sm" @click="load()">刷新快照</button>
    </div>

    <div v-else class="source-media__list">
      <article v-for="item in result.items" :key="itemKey(item)" class="source-media__row">
        <div class="source-media__target">
          <img v-if="item.target.coverUrl" :src="item.target.coverUrl" alt="" loading="lazy" width="36" height="36">
          <div>
            <strong>{{ item.target.title || `网易云歌曲 #${songId(item)}` }}</strong>
            <span>{{ item.target.artists.join('、') || item.target.albumName || `歌曲 ID ${songId(item)}` }}</span>
          </div>
        </div>
        <div class="source-media__binding">
          <span class="source-media__state" :class="`source-media__state--${item.state}`">{{ stateLabel(item.state) }}</span>
          <strong>{{ bindingLabel(item) }}</strong>
          <span v-if="staleReason(item)" class="source-media__reason">{{ staleReason(item) }}</span>
          <span v-if="item.binding?.plexFilePath || item.binding?.plexRelativePath" class="source-media__path" :title="item.binding.plexFilePath || item.binding.plexRelativePath">
            <em>Plex 关联</em>{{ item.binding.plexFilePath || item.binding.plexRelativePath }}
          </span>
          <span v-if="item.localMedia?.filePath" class="source-media__path" :title="item.localMedia.filePath">
            <em>{{ item.localMedia.ownership === 'managed' ? '托管文件' : '本地外部文件' }}</em>{{ item.localMedia.filePath }}
          </span>
          <small v-if="!item.localMedia?.filePath && !item.binding?.plexFilePath && !item.binding?.plexRelativePath">尚无可验证路径</small>
        </div>
        <div class="source-media__actions">
          <button
            v-if="!orphaned"
            class="btn btn-secondary btn-sm"
            type="button"
            :disabled="acting || !item.target.title"
            aria-label="使用 Plex 媒体"
            title="搜索 Plex 曲目，选择并确认要关联的媒体"
            @click="searchPlex(item)"
          >
            <AppIcon name="search" :size="13" />
            {{ item.binding ? '更换匹配' : '选择媒体' }}
          </button>
          <button
            v-if="canDownloadManaged(item)"
            class="btn btn-primary btn-sm"
            type="button"
            :disabled="managedDownloads.has(songId(item))"
            @click="downloadManaged(item)"
          >
            <AppIcon :name="managedDownloads.has(songId(item)) ? 'loader' : 'download'" :size="13" :class="{ 'animate-spin': managedDownloads.has(songId(item)) }" />
            {{ item.binding ? '改为下载' : '下载并托管' }}
          </button>
          <button
            v-if="item.binding && item.binding.status !== 'unbound' && (orphaned || item.binding.bindingMethod === 'manual')"
            class="btn btn-ghost btn-sm text-danger"
            type="button"
            :disabled="acting"
            @click="confirmUnbind(item)"
          >
            <AppIcon name="minusCircle" :size="14" />
            {{ item.binding.bindingMethod === 'manual' ? '取消使用' : '移除关联' }}
          </button>
        </div>

        <div v-if="searchItemKey === itemKey(item)" class="source-media__candidates">
          <p>{{ searching ? '正在搜索 Plex…' : `找到 ${searchResults.length} 个候选` }}</p>
          <article v-for="track in searchResults" :key="track.ratingKey">
            <div>
              <strong>{{ track.title }}</strong>
              <span>{{ track.artist || '未知艺人' }} · {{ track.album || '未知专辑' }}</span>
              <small>{{ track.plexFilePath || '没有媒体路径' }}</small>
            </div>
            <button class="btn btn-primary btn-sm" type="button" :disabled="!track.plexFilePath" @click="confirmRebind(item, track)">选择</button>
          </article>
          <p v-if="!searching && !searchResults.length">没有找到可使用的 Plex 曲目。</p>
        </div>
      </article>
    </div>

    <PageNavigator :page="result.page" :page-size="result.pageSize" :total="result.total" label="歌曲" :loading="loading" @change="goPage" />

    <ConfirmDialog
      :visible="Boolean(pendingAction)"
      :title="pendingAction?.kind === 'download' ? '改为下载独立副本' : pendingAction?.kind === 'rebind' ? '确认使用 Plex 媒体' : '确认移除媒体关联'"
      :message="pendingMessage"
      :confirm-label="pendingAction?.kind === 'download' ? '安排独立下载' : pendingAction?.kind === 'rebind' ? '保存关联' : '移除关联'"
      :variant="pendingAction?.kind === 'unbind' ? 'danger' : 'primary'"
      :busy="acting"
      @confirm="executePendingAction"
      @cancel="pendingAction = null"
    />
  </section>
</template>

<script setup lang="ts">
import { mediaGroups, filterMembers } from '../../shared/review-filter-groups'
import { useFeedback } from '~/composables/useFeedback'
import type { MatchOverviewItem, MatchOverviewPage, MatchOverviewState } from '~~/types/match-management'

interface PlexSearchTrack { ratingKey: string; title: string; artist: string; album: string; plexFilePath: string | null }
type PendingAction =
  | { kind: 'rebind'; item: MatchOverviewItem; track: PlexSearchTrack }
  | { kind: 'unbind'; item: MatchOverviewItem }
  | { kind: 'download'; item: MatchOverviewItem }

const props = withDefaults(defineProps<{
  sourceId: string
  mobile?: boolean
}>(), { mobile: false })
const emit = defineEmits<{ changed: [] }>()
const api = useApi()
const feedback = useFeedback()
const orphaned = computed(() => props.sourceId === 'orphaned')
const search = ref('')
const state = ref('')
const exactState = ref('')
const scoredOnly = ref(false)
const hasSnapshot = ref<boolean | null>(null)
const reasonOptions = computed(() => stateOptions.filter(option => filterMembers(mediaGroups, state.value).includes(option.value)))
const page = ref(1)
const result = ref<MatchOverviewPage>({ items: [], total: 0, page: 1, pageSize: 25, staleAfterMinutes: 10 })
const loading = ref(false)
const acting = ref(false)
const searching = ref(false)
const error = ref('')
const notice = ref('')
const searchItemKey = ref('')
const searchResults = ref<PlexSearchTrack[]>([])
const pendingAction = ref<PendingAction | null>(null)
const managedDownloads = reactive(new Set<number>())

const stateOptions: Array<{ value: MatchOverviewState; label: string }> = [
  { value: 'matched', label: '已关联' },
  { value: 'pending_alignment', label: '等待同步对齐' },
  { value: 'awaiting_manual', label: '等待手动选择' },
  { value: 'unmatched', label: '待处理' },
  { value: 'binding_stale', label: '关联失效' },
  { value: 'copyright_restricted', label: '版权受限' },
  { value: 'sync_failed', label: '同步失败' },
  { value: 'retry_paused', label: '暂停重试' },
]
const mediaStateOptions = computed(() => [
  { value: '', label: '全部状态' },
  ...mediaGroups.map(option => ({ value: option.value, label: option.label })),
])
const mediaReasonOptions = computed(() => [
  { value: '', label: '全部原因' },
  ...reasonOptions.value.map(option => ({ value: option.value as string, label: option.label })),
])

function songId(item: MatchOverviewItem) { return item.target.neteaseSongId }
function itemKey(item: MatchOverviewItem) { return item.occurrence?.id ?? `orphan-${songId(item)}` }
function stateLabel(value: MatchOverviewState) { return stateOptions.find(option => option.value === value)?.label ?? ({ historical_unverified: '历史待验证', removed: '已退出目标' } as Record<string, string>)[value] ?? value }
function bindingLabel(item: MatchOverviewItem) {
  if (!item.binding || item.binding.status === 'unbound') return '未建立媒体关联'
  return item.binding.bindingMethod === 'manual' ? `Plex 现有媒体 · #${item.binding.plexRatingKey || '未知'}` : 'YunPlex 托管文件'
}
function staleReason(item: MatchOverviewItem): string {
  if (item.state !== 'binding_stale') return ''
  const reason = typeof item.binding?.evidence?.reason === 'string' ? item.binding.evidence.reason : ''
  return ({
    adopted_media_missing: 'Plex 已找不到原关联路径',
    plex_validation_missing: 'Plex 已找不到原关联路径',
    adopted_path_ambiguous: '原关联路径对应多个 Plex 媒体',
    rebuild_managed_links: '托管关联等待重新验证',
  } as Record<string, string>)[reason] ?? '原媒体关联未通过精确路径验证'
}
function canDownloadManaged(item: MatchOverviewItem): boolean {
  return !orphaned.value && (Boolean(item.binding) || ['awaiting_manual', 'unmatched', 'binding_stale', 'sync_failed'].includes(item.state))
}

const pendingMessage = computed(() => {
  const action = pendingAction.value
  if (!action) return ''
  const affected = action.item.affectedSources.map(source => source.name)
  const impact = affected.length ? affected.join('、') : '当前没有同步源引用'
  if (action.kind === 'download') return `为歌曲 #${songId(action.item)} 下载独立托管副本。完成验证前保留当前关联和旧文件，成功后全局切换并对齐已启用来源：${impact}。禁用来源等待手动同步。`
  if (action.kind === 'rebind') {
    return `将网易云歌曲 #${songId(action.item)} 由当前 Plex #${action.item.binding?.plexRatingKey || '未关联'} 全局更换到 ${action.track.title}（Plex #${action.track.ratingKey}）。这不是当前歌单的局部设置，将影响 ${affected.length} 个来源：${impact}。`
  }
  return `将移除网易云歌曲 #${songId(action.item)} 的全局媒体关联。受影响来源：${impact}；下次同步会按“未验证媒体”设置重新处理。`
})

let loadRequest = 0
async function load(targetPage = page.value) {
  const request = ++loadRequest
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, string> = {
      sourceId: props.sourceId,
      page: String(targetPage),
      pageSize: '25',
    }
    if (!orphaned.value && state.value) params.state = exactState.value || state.value
    if (scoredOnly.value) params.origin = 'scored'
    if (search.value.trim()) params.search = search.value.trim()
    let next = await api.get<MatchOverviewPage>('/match-management/overview', params)
    if (request !== loadRequest) return
    const lastPage = Math.max(1, Math.ceil(next.total / next.pageSize))
    if (targetPage > lastPage) {
      next = await api.get<MatchOverviewPage>('/match-management/overview', { ...params, page: String(lastPage) })
      if (request !== loadRequest) return
    }
    result.value = next
    page.value = next.page
    if (!state.value && !search.value.trim() && !scoredOnly.value) hasSnapshot.value = result.value.total > 0
  } catch (err) {
    if (request === loadRequest) error.value = err instanceof Error ? err.message : '无法读取媒体状态'
  } finally {
    if (request === loadRequest) loading.value = false
  }
}
async function downloadManaged(item: MatchOverviewItem) {
  if (item.binding) { pendingAction.value = {kind:'download',item}; return }
  const id = songId(item)
  managedDownloads.add(id)
  error.value = ''
  try {
    await api.post(`/playlist-sources/${props.sourceId}/songs/${id}/download-managed`, {})
    notice.value = '已加入托管下载队列；完成后相关同步源会自动等待重新对齐。'
    feedback.success('已加入托管下载队列', '完成后相关同步源会自动等待重新对齐。')
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '启动托管下载失败'
  } finally {
    managedDownloads.delete(id)
  }
}

function applyFilters() { void load(1) }
function goPage(value: number) { void load(value) }
async function validatePlex() {
  acting.value = true
  error.value = ''
  try {
    const data = await api.post<{
      valid: number
      recovered: number
      stale: number
      unbound: number
    }>('/match-management/validate', { sourceId: props.sourceId })
    notice.value = `Plex 验证完成：${data.valid} 条有效，${data.recovered} 条已按路径恢复，${data.stale} 条失效，${data.unbound} 首未关联。`
    emit('changed')
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Plex 验证失败'
  } finally {
    acting.value = false
  }
}
async function searchPlex(item: MatchOverviewItem) {
  searchItemKey.value = itemKey(item)
  searchResults.value = []
  searching.value = true
  try {
    const data = await api.get<{ tracks: PlexSearchTrack[] }>('/match-management/plex-search', { title: item.target.title })
    searchResults.value = data.tracks
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Plex 搜索失败'
  } finally {
    searching.value = false
  }
}
function confirmRebind(item: MatchOverviewItem, track: PlexSearchTrack) { pendingAction.value = { kind: 'rebind', item, track } }
function confirmUnbind(item: MatchOverviewItem) { pendingAction.value = { kind: 'unbind', item } }

async function executePendingAction() {
  const action = pendingAction.value
  if (!action) return
  acting.value = true
  error.value = ''
  try {
    if (action.kind === 'rebind') {
      await api.post(`/match-management/bindings/${songId(action.item)}/rebind`, {
        ratingKey: action.track.ratingKey,
        expectedBindingUpdatedAt: action.item.binding?.updatedAt ?? null,
        sourceId: orphaned.value ? undefined : props.sourceId,
      })
      notice.value = 'Plex 媒体关联已保存；已启用的相关来源已排队对齐，禁用来源等待手动同步。'
      feedback.success('Plex 媒体关联已保存', '已启用的相关来源已排队对齐，禁用来源等待手动同步。')
    } else if (action.kind === 'download') {
      await api.post(`/match-management/bindings/${songId(action.item)}/download`, {expectedBindingUpdatedAt:action.item.binding?.updatedAt??null})
      notice.value = '独立副本处理已安排；完成前保留旧关联，禁用来源等待手动同步。'
    } else {
      await api.post(`/match-management/bindings/${songId(action.item)}/unbind`, {
        expectedBindingUpdatedAt: action.item.binding?.updatedAt,
        mode: 'reevaluate',
        sourceId: orphaned.value ? undefined : props.sourceId,
      })
      notice.value = '媒体关联已移除；系统会在下次同步时重新评估。'
      feedback.success('媒体关联已移除', '系统会在下次同步时重新评估。')
    }
    pendingAction.value = null
    searchItemKey.value = ''
    emit('changed')
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '媒体关联更新失败'
  } finally {
    acting.value = false
  }
}

watch(() => props.sourceId, () => { page.value = 1; void load() }, { immediate: true })
</script>

<style scoped>
.source-media { display: grid; gap: var(--space-3_5); min-width: 0; }
.source-media__header, .source-media__filters, .source-media__row, .source-media__actions { display: flex; align-items: center; }
.source-media__header { justify-content: space-between; gap: var(--space-4); }
.source-media__header div { min-width: 0; }
.source-media__header p { margin: var(--space-0_5) 0 0; color: var(--text-muted); font-size: var(--text-xs); line-height: var(--body-leading); }
.source-media__filters { flex-wrap: wrap; gap: var(--space-2); }
.source-media__filter { width: 10rem; }
.source-media__search { position: relative; flex: 1; min-width: 10rem; }
.source-media__search svg { position: absolute; left: .7rem; top: 50%; z-index: 1; transform: translateY(-50%); color: var(--text-muted); }
.source-media__search input { width: 100%; padding-left: var(--space-8); }
.source-media__list { display: grid; gap: var(--space-2); }
.source-media__row { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) 10rem; gap: var(--space-4); padding: var(--space-4); border: 1px solid var(--border-primary); border-radius: var(--radius-lg); background: var(--bg-surface); min-width: 0; }
.source-media__target { display: flex; align-items: center; gap: var(--space-2_5); min-width: 0; }
.source-media__target img { width: 36px; height: 36px; border-radius: var(--radius-sm); object-fit: cover; }
.source-media__target div, .source-media__binding { display: grid; gap: var(--space-0_5); min-width: 0; }
.source-media__target strong, .source-media__target span, .source-media__binding strong, .source-media__binding small, .source-media__path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-media__target strong, .source-media__binding strong { color: var(--text-primary); font-size: var(--text-xs); }
.source-media__target span, .source-media__binding small { color: var(--text-muted); font-size: var(--text-xs); }
.source-media__reason { color: var(--warning); font-size: var(--text-xs); line-height: var(--body-leading); }
.source-media__path { color: var(--text-muted); font-size: var(--text-xs); }
.source-media__path em { margin-right: var(--space-1_5); color: var(--text-secondary); font-style: normal; font-weight: var(--font-weight-semibold); }
.source-media__state { width: max-content; color: var(--text-secondary); font-size: var(--text-xs); }
.source-media__state--matched { color: var(--success); }
.source-media__state--awaiting_manual, .source-media__state--binding_stale, .source-media__state--sync_failed, .source-media__state--copyright_restricted, .source-media__state--retry_paused { color: var(--warning); }
.source-media__actions { align-items: flex-end; flex-direction: column; gap: var(--space-2); }
.source-media__candidates { grid-column: 1 / -1; display: grid; gap: var(--space-1_5); padding-top: var(--space-2); border-top: 1px solid var(--border-primary); }
.source-media__candidates > article { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2); border-radius: var(--radius-md); background: var(--bg-hover); }
.source-media__candidates div { display: grid; min-width: 0; }
.source-media__candidates strong, .source-media__candidates span, .source-media__candidates small, .source-media__candidates p { font-size: var(--text-xs); }
.source-media__candidates span, .source-media__candidates small, .source-media__candidates p { color: var(--text-muted); }
.source-media__empty { padding: var(--space-5); text-align: center; color: var(--text-muted); font-size: var(--text-xs); }
.source-media__notice, .source-media__error { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); font-size: var(--text-xs); }
.source-media__notice { color: var(--success); background: color-mix(in srgb, var(--success) 9%, transparent); }
.source-media__error { color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); }
@media (max-width: 900px) {
  .source-media__header, .source-media__filters { align-items: flex-end; flex-direction: column; }
  .source-media__filter { width: 100%; }
  .source-media__row { grid-template-columns: 1fr; }
  .source-media__actions { flex-direction: row; flex-wrap: wrap; justify-content: flex-start; }
}
</style>
