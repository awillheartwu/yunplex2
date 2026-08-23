<template>
  <section class="source-media" :class="{ 'source-media--mobile': mobile, 'source-media--orphaned': orphaned }" :aria-busy="loading">
    <header class="source-media__header">
      <div>
        <strong>{{ orphaned ? '孤立媒体关联' : '歌曲与媒体' }}</strong>
        <p>{{ orphaned ? '这些关联已不属于任何当前同步源，可在此检查或移除。' : '媒体关联按网易云歌曲 ID 全局生效；托管文件仍只按精确路径自动复用。' }}</p>
      </div>
      <NuxtLink v-if="!orphaned" class="btn btn-ghost btn-xs" to="/match-reviews">高级：孤立关联</NuxtLink>
    </header>

    <div class="source-media__filters">
      <label class="source-media__search">
        <AppIcon name="search" :size="14" />
        <input v-model="search" class="form-input" :placeholder="orphaned ? '搜索歌曲 ID 或媒体路径' : '搜索歌曲、艺人、ID 或媒体路径'" @keyup.enter="applyFilters">
      </label>
      <select v-if="!orphaned" v-model="state" class="form-input" aria-label="媒体状态" @change="applyFilters">
        <option value="">全部状态</option>
        <option v-for="option in stateOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <button v-if="!orphaned" class="btn btn-secondary btn-xs" type="button" :disabled="acting || loading" @click="validatePlex">
        <AppIcon :name="acting ? 'loader' : 'checkCircle'" :size="13" :class="{ 'animate-spin': acting }" />
        验证 Plex
      </button>
      <button class="btn btn-secondary btn-xs" type="button" :disabled="loading" @click="load">
        <AppIcon :name="loading ? 'loader' : 'refresh'" :size="13" :class="{ 'animate-spin': loading }" />
        刷新
      </button>
    </div>

    <p v-if="notice" class="source-media__notice" role="status">{{ notice }}</p>
    <p v-if="error" class="source-media__error" role="alert">{{ error }}</p>
    <div v-if="loading && !result.items.length" class="source-media__empty">加载媒体状态…</div>
    <div v-else-if="!result.items.length" class="source-media__empty">
      {{ orphaned ? '没有孤立媒体关联' : '当前来源还没有歌曲快照，请先同步一次。' }}
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
          <small :title="item.localMedia?.filePath || item.binding?.plexRelativePath || ''">{{ mediaPath(item) }}</small>
        </div>
        <div class="source-media__actions">
          <button
            v-if="!orphaned"
            class="btn btn-secondary btn-xs"
            type="button"
            :disabled="acting || !item.target.title"
            @click="searchPlex(item)"
          >
            <AppIcon name="search" :size="13" />
            接管媒体
          </button>
          <button
            v-if="item.binding && item.binding.status !== 'unbound' && (orphaned || item.binding.bindingMethod === 'manual')"
            class="btn btn-ghost btn-xs text-danger"
            type="button"
            :disabled="acting"
            @click="confirmUnbind(item)"
          >
            {{ item.binding.bindingMethod === 'manual' ? '取消接管' : '移除关联' }}
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
            <button class="btn btn-primary btn-xs" type="button" :disabled="!track.plexFilePath" @click="confirmRebind(item, track)">选择</button>
          </article>
          <p v-if="!searching && !searchResults.length">没有找到可接管的 Plex 曲目。</p>
        </div>
      </article>
    </div>

    <nav v-if="result.total > result.pageSize" class="source-media__pagination" aria-label="歌曲分页">
      <button class="btn btn-secondary btn-xs" type="button" :disabled="result.page <= 1 || loading" @click="goPage(result.page - 1)">上一页</button>
      <span>{{ result.page }} / {{ Math.ceil(result.total / result.pageSize) }} · 共 {{ result.total }} 首</span>
      <button class="btn btn-secondary btn-xs" type="button" :disabled="result.page >= Math.ceil(result.total / result.pageSize) || loading" @click="goPage(result.page + 1)">下一页</button>
    </nav>

    <ConfirmDialog
      :visible="Boolean(pendingAction)"
      :title="pendingAction?.kind === 'rebind' ? '确认接管 Plex 媒体' : '确认移除媒体关联'"
      :message="pendingMessage"
      :confirm-label="pendingAction?.kind === 'rebind' ? '保存接管' : '移除关联'"
      :variant="pendingAction?.kind === 'rebind' ? 'primary' : 'danger'"
      :busy="acting"
      @confirm="executePendingAction"
      @cancel="pendingAction = null"
    />
  </section>
</template>

<script setup lang="ts">
import type { MatchOverviewItem, MatchOverviewPage, MatchOverviewState } from '~~/types/match-management'

interface PlexSearchTrack { ratingKey: string; title: string; artist: string; album: string; plexFilePath: string | null }
type PendingAction =
  | { kind: 'rebind'; item: MatchOverviewItem; track: PlexSearchTrack }
  | { kind: 'unbind'; item: MatchOverviewItem }

const props = withDefaults(defineProps<{
  sourceId: string
  mobile?: boolean
}>(), { mobile: false })
const emit = defineEmits<{ changed: [] }>()
const api = useApi()
const orphaned = computed(() => props.sourceId === 'orphaned')
const search = ref('')
const state = ref<MatchOverviewState | ''>('')
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

const stateOptions: Array<{ value: MatchOverviewState; label: string }> = [
  { value: 'matched', label: '已关联' },
  { value: 'pending_alignment', label: '等待同步对齐' },
  { value: 'unmatched', label: '待下载或接管' },
  { value: 'binding_stale', label: '关联失效' },
  { value: 'copyright_restricted', label: '版权受限' },
  { value: 'sync_failed', label: '同步失败' },
  { value: 'retry_paused', label: '暂停重试' },
]

function songId(item: MatchOverviewItem) { return item.target.neteaseSongId }
function itemKey(item: MatchOverviewItem) { return item.occurrence?.id ?? `orphan-${songId(item)}` }
function stateLabel(value: MatchOverviewState) { return stateOptions.find(option => option.value === value)?.label ?? ({ historical_unverified: '历史待验证', removed: '已退出目标' } as Record<string, string>)[value] ?? value }
function bindingLabel(item: MatchOverviewItem) {
  if (!item.binding || item.binding.status === 'unbound') return '未建立媒体关联'
  return item.binding.bindingMethod === 'manual' ? `外部媒体 · Plex #${item.binding.plexRatingKey || '未知'}` : 'YunPlex 托管文件'
}
function mediaPath(item: MatchOverviewItem) { return item.localMedia?.filePath || item.binding?.plexRelativePath || '尚无可验证路径' }

const pendingMessage = computed(() => {
  const action = pendingAction.value
  if (!action) return ''
  const affected = action.item.affectedSources.map(source => source.name)
  const impact = affected.length ? affected.join('、') : '当前没有同步源引用'
  if (action.kind === 'rebind') {
    return `将网易云歌曲 #${songId(action.item)} 全局接管为 Plex #${action.track.ratingKey}。这不是当前歌单的局部设置，将影响 ${affected.length} 个来源：${impact}。`
  }
  return `将移除网易云歌曲 #${songId(action.item)} 的全局媒体关联。受影响来源：${impact}；下次同步无法确认托管媒体时会下载独立副本。`
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, string> = {
      sourceId: props.sourceId,
      page: String(page.value),
      pageSize: '25',
    }
    if (!orphaned.value && state.value) params.state = state.value
    if (search.value.trim()) params.search = search.value.trim()
    result.value = await api.get<MatchOverviewPage>('/match-management/overview', params)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '无法读取媒体状态'
  } finally {
    loading.value = false
  }
}

function applyFilters() { page.value = 1; void load() }
function goPage(value: number) { page.value = value; void load() }
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
      notice.value = '媒体接管已保存；所有引用这首网易云歌曲的来源会在下次同步时对齐。'
    } else {
      await api.post(`/match-management/bindings/${songId(action.item)}/unbind`, {
        expectedBindingUpdatedAt: action.item.binding?.updatedAt,
        mode: 'reevaluate',
        sourceId: orphaned.value ? undefined : props.sourceId,
      })
      notice.value = '媒体关联已移除；系统会在下次同步时重新评估。'
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
.source-media { display: grid; gap: .85rem; min-width: 0; }
.source-media__header, .source-media__filters, .source-media__row, .source-media__actions, .source-media__pagination { display: flex; align-items: center; }
.source-media__header { justify-content: space-between; gap: 1rem; }
.source-media__header div { min-width: 0; }
.source-media__header strong { color: var(--text-primary); font-size: .86rem; }
.source-media__header p { margin: .18rem 0 0; color: var(--text-muted); font-size: .72rem; line-height: 1.45; }
.source-media__filters { gap: .55rem; }
.source-media__filters select { width: 10rem; }
.source-media__search { position: relative; flex: 1; min-width: 10rem; }
.source-media__search svg { position: absolute; left: .7rem; top: 50%; z-index: 1; transform: translateY(-50%); color: var(--text-muted); }
.source-media__search input { width: 100%; padding-left: 2rem; }
.source-media__list { display: grid; gap: .45rem; }
.source-media__row { display: grid; grid-template-columns: minmax(13rem, 1.1fr) minmax(13rem, 1fr) auto; gap: .8rem; padding: .65rem .75rem; border: 1px solid var(--border-primary); border-radius: .7rem; background: var(--bg-surface); min-width: 0; }
.source-media__target { display: flex; align-items: center; gap: .6rem; min-width: 0; }
.source-media__target img { width: 36px; height: 36px; border-radius: .4rem; object-fit: cover; }
.source-media__target div, .source-media__binding { display: grid; gap: .15rem; min-width: 0; }
.source-media__target strong, .source-media__target span, .source-media__binding strong, .source-media__binding small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-media__target strong, .source-media__binding strong { color: var(--text-primary); font-size: .75rem; }
.source-media__target span, .source-media__binding small { color: var(--text-muted); font-size: .68rem; }
.source-media__state { width: max-content; color: var(--accent); font-size: .65rem; }
.source-media__state--binding_stale, .source-media__state--sync_failed, .source-media__state--copyright_restricted, .source-media__state--retry_paused { color: var(--warning); }
.source-media__actions { justify-content: flex-end; gap: .35rem; flex-wrap: wrap; }
.source-media__candidates { grid-column: 1 / -1; display: grid; gap: .4rem; padding-top: .55rem; border-top: 1px solid var(--border-primary); }
.source-media__candidates > article { display: flex; align-items: center; justify-content: space-between; gap: .8rem; padding: .5rem; border-radius: .55rem; background: var(--bg-hover); }
.source-media__candidates div { display: grid; min-width: 0; }
.source-media__candidates strong, .source-media__candidates span, .source-media__candidates small, .source-media__candidates p { font-size: .7rem; }
.source-media__candidates span, .source-media__candidates small, .source-media__candidates p { color: var(--text-muted); }
.source-media__empty { padding: 1.2rem; text-align: center; color: var(--text-muted); font-size: .75rem; }
.source-media__notice, .source-media__error { margin: 0; padding: .55rem .7rem; border-radius: .55rem; font-size: .72rem; }
.source-media__notice { color: var(--success); background: color-mix(in srgb, var(--success) 9%, transparent); }
.source-media__error { color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); }
.source-media__pagination { justify-content: center; gap: .75rem; color: var(--text-muted); font-size: .7rem; }
@media (max-width: 760px) {
  .source-media__header, .source-media__filters { align-items: stretch; flex-direction: column; }
  .source-media__filters select { width: 100%; }
  .source-media__row { grid-template-columns: 1fr; }
  .source-media__actions { justify-content: flex-start; }
}
</style>
