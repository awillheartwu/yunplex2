<template>
  <section class="source-media" :class="{ 'source-media--mobile': mobile, 'source-media--orphaned': orphaned }" :aria-busy="loading">
    <header class="source-media__header">
      <div>
        <h2>{{ orphaned ? '未使用的关联' : '歌曲与媒体' }}</h2>
        <p>{{ orphaned ? '这些关联已不属于任何收藏，可查看或移除。' : '同一首歌的关联由所有收藏共用，修改会同时影响这些收藏。' }}</p>
      </div>
      <NuxtLink v-if="!orphaned" class="btn btn-ghost btn-sm" to="/match-reviews">高级：未使用的关联</NuxtLink>
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

    <label v-if="!orphaned && hasSnapshot !== false" class="source-media__scored"><input v-model="scoredOnly" type="checkbox" @change="applyFilters"> 仅看评分产生的关联</label>
    <p v-if="notice" class="source-media__notice" role="status">{{ notice }}</p>
    <p v-if="error" class="source-media__error" role="alert">{{ error }}</p>
    <div v-if="batchEnabled && (selectableSongs.size || selectedSongs.size)" class="source-media__batch" role="group" aria-label="批量处理歌曲">
      <label class="source-media__check">
        <input type="checkbox" :checked="allPageSelected" :indeterminate.prop="selectedOnPage > 0 && !allPageSelected" :disabled="loading || acting || !selectableSongs.size" @change="togglePageSelection">
        全选本页
      </label>
      <span role="status">已选 {{ selectedSongs.size }} 首</span>
      <button v-if="selectedSongs.size" class="btn btn-ghost btn-sm" type="button" :disabled="acting" @click="selectedSongs.clear()">清空选择</button>
      <ListSelect v-model="batchAction" aria-label="批量操作" :options="batchActionOptions" :disabled="acting" />
      <button class="btn btn-soft btn-sm" type="button" :disabled="loading || acting || !selectedSongs.size" @click="batchAction === 'download' ? downloadBatch() : previewBatch()">
        {{ batchAction === 'download' ? (batchDownloading ? '正在提交…' : '下载所选') : '批量预选媒体' }}
      </button>
    </div>
    <div v-if="loading && !result.items.length" class="source-media__empty">正在读取媒体状态…</div>
    <div v-else-if="!result.items.length" class="source-media__empty">
      {{ orphaned ? '没有未使用的关联' : (state || search || scoredOnly ? '没有符合条件的歌曲，换个筛选或搜索词再试。' : '还没有读到这个收藏的歌曲，先同步一次再看。') }}
      <button v-if="!orphaned && hasSnapshot === false" class="btn btn-secondary btn-sm" @click="load()">刷新列表</button>
    </div>

    <div v-else class="source-media__list">
      <article v-for="item in result.items" :key="itemKey(item)" class="source-media__row">
        <div class="source-media__target">
          <label v-if="canBatchSelect(item)" class="source-media__check source-media__check--song">
            <input type="checkbox" :checked="selectedSongs.has(songId(item))" :disabled="loading || acting" :aria-label="`勾选 ${item.target.title}`" @change="toggleSongSelection(item)">
          </label>
          <img v-if="item.target.coverUrl" :src="item.target.coverUrl" alt="" loading="lazy" width="80" height="80">
          <div>
            <strong :title="item.target.title">{{ item.target.title || `网易云歌曲 #${songId(item)}` }}</strong>
            <span>{{ item.target.artists.join('、') || item.target.albumName || `歌曲 ID ${songId(item)}` }}</span>
          </div>
        </div>
        <div class="source-media__binding">
          <span class="source-media__state" :class="`source-media__state--${item.state}`">{{ item.state === 'retry_paused' && item.ignored ? '已忽略' : stateLabel(item.state) }}</span>
          <strong>{{ bindingLabel(item) }}</strong>
          <span v-if="staleReason(item)" class="source-media__reason">{{ staleReason(item) }}</span>
          <span v-if="item.issue" class="source-media__reason">{{ item.issue }}</span>
          <span v-if="item.occurrence?.alignmentStatus === 'aligned' && item.occurrence.occurrence > 0" class="source-media__reason">来源重复曲目，Plex 只收录一次</span>
          <span v-if="selectedSongs.get(songId(item))?.issue" class="source-media__reason">{{ selectedSongs.get(songId(item))?.issue }}</span>
          <span v-if="plexPath(item)" class="source-media__path" :title="plexPath(item)">
            <em>Plex 路径</em>{{ plexPath(item) }}
          </span>
          <span v-if="item.localMedia?.filePath" class="source-media__path" :title="item.localMedia.filePath">
            <em>{{ item.localMedia.ownership === 'managed' ? '下载文件' : '本地文件' }}</em>{{ item.localMedia.filePath }}
          </span>
          <small v-if="!item.localMedia?.filePath && !plexPath(item)">还看不到文件路径</small>
        </div>
        <div class="source-media__actions">
          <ActionHint v-if="!orphaned" :text="changeHint(item)">
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="acting || !item.target.title"
              :aria-label="item.binding ? '更换 Plex 匹配' : '选择 Plex 媒体'"
              @click="searchPlex(item)"
            >
              <AppIcon name="search" :size="14" />
              {{ item.binding ? '更换' : '选择' }}
            </button>
          </ActionHint>
          <ActionHint v-if="canDownloadManaged(item)" :text="downloadHint(item)">
            <button
              class="btn btn-soft btn-sm"
              type="button"
              :disabled="batchDownloading || managedDownloads.has(songId(item))"
              :aria-label="item.binding && item.binding.status !== 'unbound' ? '下载新文件替换当前关联' : '下载并关联这首歌'"
              @click="downloadManaged(item)"
            >
              <AppIcon :name="managedDownloads.has(songId(item)) ? 'loader' : 'download'" :size="14" :class="{ 'animate-spin': managedDownloads.has(songId(item)) }" />
              下载
            </button>
          </ActionHint>
          <ActionHint v-if="canUnbind(item)" :text="unbindHint()">
            <button
              class="btn btn-warning btn-sm"
              type="button"
              :disabled="acting"
              :aria-label="orphaned ? '移除未使用的关联' : '停止使用当前关联'"
              @click="confirmUnbind(item)"
            >
              <AppIcon name="minusCircle" :size="14" />
              {{ orphaned ? '移除' : '停用' }}
            </button>
          </ActionHint>
          <ActionHint v-if="canValidateBinding(item)" text="核对 Plex 文件和歌单是否一致；找不到文件时会标记为失效。">
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="acting || validatingId !== null"
              aria-label="重新核对 Plex 文件"
              @click="validateBinding(item)"
            >
              <AppIcon :name="validatingId === songId(item) ? 'loader' : 'checkCircle'" :size="14" :class="{ 'animate-spin': validatingId === songId(item) }" />
              核对
            </button>
          </ActionHint>
        </div>

        <div v-if="searchItemKey === itemKey(item)" class="source-media__candidates">
          <p>{{ searching ? '正在搜索 Plex…' : `找到 ${searchResults.length} 个候选` }}</p>
          <article v-for="track in searchResults" :key="track.ratingKey">
            <div>
              <strong>{{ track.title }}</strong>
              <span>{{ track.artist || '未知艺人' }} · {{ track.album || '未知专辑' }}</span>
              <small>{{ track.plexFilePath || '没有媒体路径' }}</small>
            </div>
            <button class="btn btn-soft btn-sm" type="button" :disabled="!track.plexFilePath" @click="confirmRebind(item, track)">选择</button>
          </article>
          <p v-if="!searching && !searchResults.length">没有找到可使用的 Plex 曲目。</p>
        </div>
      </article>
    </div>

    <PageNavigator :page="result.page" :page-size="result.pageSize" :total="result.total" label="歌曲" :loading="loading" @change="goPage" />

    <ConfirmDialog
      :visible="Boolean(batchPreview)"
      title="确认批量关联"
      :confirm-label="`保存 ${batchReadyCount} 首关联`"
      :confirm-disabled="batchLoading || !batchReadyCount"
      :busy="acting"
      @confirm="saveBatch"
      @cancel="batchPreview = null"
    >
      <div v-if="batchPreview" class="source-media__batch-preview">
        <p>已按曲名、艺人、版本和时长核对候选。共用需逐首确认，Plex 歌单中只保留该媒体的一项。</p>
        <p v-if="batchLoading" role="status">正在搜索 Plex（{{ batchPreview.rows.length }} / {{ batchPreview.total }}）…</p>
        <ul>
          <li v-for="row in batchPreview.rows" :key="songId(row.item)">
            <div><strong>{{ row.item.target.title }}</strong> <span>{{ row.item.target.artists.join('、') }} · {{ row.item.target.albumName || '未知专辑' }} · {{ formatDuration(row.item.occurrence?.durationMs) }}</span></div>
            <label v-if="row.track && !row.track.owners.length" class="source-media__batch-choice">
              <input v-model="row.included" type="checkbox" :disabled="acting" :aria-label="`保存 ${row.item.target.title} 的首选媒体`">
              <span>
                <strong>{{ row.track.title }}</strong>
                <span>{{ row.track.artist || '未知艺人' }} · {{ row.track.album || '未知专辑' }} · {{ formatDuration(row.track.durationMs) }}</span>
                <small>{{ row.track.plexFilePath }}</small>
              </span>
            </label>
            <div v-else-if="row.track" class="source-media__batch-occupied">
              <p>Plex · <strong>{{ row.track.title }}</strong> · {{ row.track.artist || '未知艺人' }} · {{ row.track.album || '未知专辑' }} · {{ formatDuration(row.track.durationMs) }}</p>
              <small>{{ row.track.plexFilePath }}</small>
              <p v-for="owner in row.track.owners" :key="owner.songId">
                已关联 · <strong>{{ owner.title || '未知曲名' }}</strong> · {{ owner.artists.join('、') || '未知艺人' }} · {{ owner.album || '未知专辑' }} · {{ formatDuration(owner.durationMs) }} · #{{ owner.songId }}
              </p>
              <p v-if="row.track.shareIssue" class="source-media__reason">{{ row.track.shareIssue }}</p>
              <label v-else class="source-media__check">
                <input v-model="row.included" type="checkbox" :disabled="acting" :aria-label="`确认共用 ${row.item.target.title} 的文件`">
                确认共用同一录音
              </label>
            </div>
            <p v-else class="source-media__reason">{{ row.issue }}</p>
          </li>
        </ul>
        <p v-if="batchPreview.error" class="source-media__error" role="alert">{{ batchPreview.error }}</p>
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      :visible="Boolean(pendingAction)"
      :title="pendingAction?.kind === 'download' ? '下载一份新文件' : pendingAction?.kind === 'rebind' ? '确认更换关联的文件' : '确认停止使用'"
      :message="pendingMessage"
      :confirm-label="pendingAction?.kind === 'download' ? '开始下载' : pendingAction?.kind === 'rebind' ? '保存关联' : '停止使用'"
      :variant="pendingAction?.kind === 'unbind' ? 'danger' : 'primary'"
      :busy="acting"
      @confirm="executePendingAction"
      @cancel="pendingAction = null"
    />
  </section>
</template>

<script setup lang="ts">
import { mediaGroups, filterMembers } from '../../shared/review-filter-groups'
import { sseSubscribe } from '~/composables/sse'
import { useFeedback } from '~/composables/useFeedback'
import { formatManualDuration as formatDuration } from '~/composables/useManualDownloadPresentation'
import { useThrottleFn } from '~/composables/useTiming'
import type { BatchPlexBindingChoice, BatchPlexBindingResult, BatchPlexCandidate, BatchPlexPreviewResult, ManagedDownloadBatchResult, MatchOverviewItem, MatchOverviewPage, MatchOverviewState } from '~~/types/match-management'

interface PlexSearchTrack { ratingKey: string; title: string; artist: string; album: string; plexFilePath: string | null }
type PendingAction =
  | { kind: 'rebind'; item: MatchOverviewItem; track: PlexSearchTrack }
  | { kind: 'unbind'; item: MatchOverviewItem }
  | { kind: 'download'; item: MatchOverviewItem }
interface SelectedSong { item: MatchOverviewItem; issue?: string }
interface BatchPreviewRow extends SelectedSong {
  track?: BatchPlexCandidate
  included: boolean
}
interface BatchPreview { rows: BatchPreviewRow[]; total: number; error: string }

const props = withDefaults(defineProps<{
  sourceId: string
  targetSongId?: number
  mobile?: boolean
}>(), { targetSongId: undefined, mobile: false })
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
const batchEnabled = computed(() => !orphaned.value && state.value === 'needs_action')
const batchAction = ref('preview')
const batchDownloading = ref(false)
const batchActionOptions = [
  { value: 'preview', label: '首个符合条件的候选' },
  { value: 'download', label: '批量下载' },
]
const selectedSongs = ref(new Map<number, SelectedSong>())
const selectableSongs = computed(() => new Map(result.value.items.filter(canBatchSelect).map(item => [songId(item), item])))
const selectedOnPage = computed(() => [...selectableSongs.value.keys()].filter(id => selectedSongs.value.has(id)).length)
const allPageSelected = computed(() => selectableSongs.value.size > 0 && selectedOnPage.value === selectableSongs.value.size)
const batchPreview = ref<BatchPreview | null>(null)
const batchLoading = computed(() => Boolean(batchPreview.value && batchPreview.value.rows.length < batchPreview.value.total))
const batchReadyCount = computed(() => batchPreview.value?.rows.filter(row => row.included).length ?? 0)

const stateOptions: Array<{ value: MatchOverviewState; label: string }> = [
  { value: 'matched', label: '已关联' },
  { value: 'pending_alignment', label: '等待同步更新' },
  { value: 'awaiting_manual', label: '等待手动选择' },
  { value: 'binding_review', label: '关联待核对' },
  { value: 'unmatched', label: '待处理' },
  { value: 'binding_stale', label: '关联失效' },
  { value: 'copyright_restricted', label: '版权受限' },
  { value: 'sync_failed', label: '同步失败' },
  { value: 'retry_paused', label: '已暂停' },
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
function canBatchSelect(item: MatchOverviewItem): boolean {
  return batchEnabled.value && Boolean(item.target.title.trim()) && (!item.binding || item.binding.status === 'unbound')
    && filterMembers(mediaGroups, 'needs_action').includes(item.state)
}
function stateLabel(value: MatchOverviewState) { return stateOptions.find(option => option.value === value)?.label ?? ({ historical_unverified: '尚未核对', removed: '已从收藏移除' } as Record<string, string>)[value] ?? value }
function plexPath(item: MatchOverviewItem) { return item.binding?.plexFilePath || item.binding?.plexRelativePath || '' }
function bindingLabel(item: MatchOverviewItem) {
  if (!item.binding || item.binding.status === 'unbound') return '还没有关联的媒体'
  return item.binding.bindingMethod === 'manual'
    ? `手动选择的 Plex 文件${item.binding.plexRatingKey ? ` · #${item.binding.plexRatingKey}` : ''}`
    : 'YunPlex 下载的文件'
}
function staleReason(item: MatchOverviewItem): string {
  if (item.state !== 'binding_stale') return ''
  const reason = typeof item.binding?.evidence?.reason === 'string' ? item.binding.evidence.reason : ''
  return ({
    adopted_media_missing: 'Plex 里已经找不到这个文件',
    plex_validation_missing: 'Plex 里已经找不到这个文件',
    adopted_path_ambiguous: '这个路径在 Plex 里对应多个文件',
    rebuild_managed_links: 'YunPlex 下载的文件需要重新核对',
  } as Record<string, string>)[reason] ?? '这条关联和 Plex 里的文件对不上'
}
function canDownloadManaged(item: MatchOverviewItem): boolean {
  return !orphaned.value && (Boolean(item.binding) || ['awaiting_manual', 'unmatched', 'binding_stale', 'sync_failed'].includes(item.state))
}
function canUnbind(item: MatchOverviewItem): boolean {
  return Boolean(item.binding && item.binding.status !== 'unbound' && (orphaned.value || item.binding.bindingMethod === 'manual'))
}
function canValidateBinding(item: MatchOverviewItem): boolean {
  return !orphaned.value && item.binding?.status === 'active' && ['pending_alignment', 'historical_unverified', 'binding_review'].includes(item.state)
}
function changeHint(item: MatchOverviewItem): string {
  return item.binding
    ? '选择新的 Plex 文件，使用这首歌的收藏会同时更新。'
    : '搜索 Plex 曲目，选择这首歌要使用的文件。'
}
function downloadHint(item: MatchOverviewItem): string {
  return item.binding && item.binding.status !== 'unbound'
    ? '下载新文件并替换关联，使用这首歌的收藏会同时更新。'
    : '下载一份新文件并关联这首歌。'
}
function unbindHint(): string {
  return orphaned.value
    ? '移除已不属于任何收藏的关联。'
    : '解除关联后，下次同步将重新选择或下载文件。'
}
const validatingId = ref<number | null>(null)

const pendingMessage = computed(() => {
  const action = pendingAction.value
  if (!action) return ''
  const affected = action.item.affectedSources.map(source => source.name)
  const impact = affected.length ? affected.join('、') : '现在没有收藏使用这首歌'
  if (action.kind === 'download') {
    return `为这首歌下载一份新文件。下载和校验完成前继续使用现在的关联和文件，完成后这些收藏会改用新文件：${impact}。暂停同步的收藏要手动同步一次。`
  }
  if (action.kind === 'rebind') {
    return `改用 ${action.track.title}（Plex #${action.track.ratingKey}）。以下收藏会同步更新：${impact}。原文件保留。`
  }
  return `解除 Plex 关联，以下收藏会受影响：${impact}。下次同步将重新选择或下载音乐，原文件保留。`
})

let loadRequest = 0
let selectionScope = ''
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
    const query = search.value.trim()
    if (props.targetSongId !== undefined && query === String(props.targetSongId)) params.songId = query
    else if (query) params.search = query
    const scope = JSON.stringify([params.sourceId, params.state, params.origin, params.songId, params.search])
    if (scope !== selectionScope) {
      selectionScope = scope
      selectedSongs.value = new Map()
      batchPreview.value = null
    }
    let next = await api.get<MatchOverviewPage>('/match-management/overview', params)
    if (request !== loadRequest) return
    const lastPage = Math.max(1, Math.ceil(next.total / next.pageSize))
    if (targetPage > lastPage) {
      next = await api.get<MatchOverviewPage>('/match-management/overview', { ...params, page: String(lastPage) })
      if (request !== loadRequest) return
    }
    result.value = next
    page.value = next.page
    for (const item of next.items) {
      const id = songId(item)
      const selected = selectedSongs.value.get(id)
      if (!selected) continue
      if (canBatchSelect(item)) selected.item = item
      else selectedSongs.value.delete(id)
    }
    if (!state.value && !search.value.trim() && !scoredOnly.value) hasSnapshot.value = result.value.total > 0
  } catch (err) {
    if (request === loadRequest) error.value = err instanceof Error ? err.message : '无法读取媒体状态'
  } finally {
    if (request === loadRequest) loading.value = false
  }
}
async function downloadManaged(item: MatchOverviewItem) {
  if (item.binding && item.binding.status !== 'unbound') { pendingAction.value = {kind:'download',item}; return }
  const id = songId(item)
  managedDownloads.add(id)
  error.value = ''
  try {
    await api.post(`/playlist-sources/${props.sourceId}/songs/${id}/download-managed`, {})
    const next = 'Plex 收录文件后会按准确路径自动关联。'
    notice.value = `已加入下载队列。${next}`
    feedback.success('已加入下载队列', next)
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '开始下载失败'
  } finally {
    managedDownloads.delete(id)
  }
}

function applyFilters() { void load(1) }
function goPage(value: number) { void load(value) }
function toggleSongSelection(item: MatchOverviewItem) {
  const id = songId(item)
  if (!selectedSongs.value.delete(id)) selectedSongs.value.set(id, { item })
}
function togglePageSelection() {
  const clear = allPageSelected.value
  for (const [id, item] of selectableSongs.value) {
    if (clear) selectedSongs.value.delete(id)
    else if (!selectedSongs.value.has(id)) selectedSongs.value.set(id, { item })
  }
}

async function downloadBatch() {
  if (loading.value || acting.value || !selectedSongs.value.size) return
  const selection = selectedSongs.value
  const songIds = [...selection.keys()]
  acting.value = true
  batchDownloading.value = true
  error.value = ''
  notice.value = ''
  try {
    const { total, selectionFailures } = await api.post<ManagedDownloadBatchResult>(
      `/playlist-sources/${props.sourceId}/songs/download-managed`, { songIds },
    )
    if (selectedSongs.value !== selection) return
    const failures = new Map(selectionFailures.map(({ songId, reason }) => [songId, reason]))
    for (const id of songIds) {
      const reason = failures.get(id)
      const selected = selection.get(id)
      if (reason && selected) selected.issue = reason
      else selection.delete(id)
    }
    if (total) {
      const skipped = failures.size ? `，${failures.size} 首未能加入队列` : ''
      notice.value = `${total} 首已提交到下载队列${skipped}。Plex 收录文件后会按准确路径自动关联。`
      emit('changed')
    } else {
      error.value = `${failures.size} 首未能加入下载队列，原因见各歌曲。`
    }
  } catch (err) {
    if (selectedSongs.value === selection) error.value = err instanceof Error ? err.message : '批量下载提交失败'
  } finally {
    batchDownloading.value = false
    acting.value = false
  }
}

async function previewBatch() {
  if (loading.value || acting.value || batchPreview.value || !selectedSongs.value.size) return
  const items = [...selectedSongs.value.values()].map(selected => selected.item)
  const preview = reactive<BatchPreview>({ rows: [], total: items.length, error: '' })
  const chosenRatingKeys = new Set<string>()
  const chosenPaths = new Set<string>()
  batchPreview.value = preview
  for (let offset = 0; offset < items.length && batchPreview.value === preview; offset += 3) {
    const results = await Promise.all(items.slice(offset, offset + 3).map(async (item) => {
      try {
        const candidates = await api.get<BatchPlexPreviewResult>('/match-management/plex-search', {
          availableForSongId: String(songId(item)), sourceId: props.sourceId,
        })
        return { item, ...candidates }
      } catch (err) {
        return { item, tracks: [], occupied: [], issue: err instanceof Error ? err.message : 'Plex 搜索失败' }
      }
    }))
    if (batchPreview.value !== preview) return
    for (const { item, tracks, occupied, issue } of results) {
      const track = tracks.find(candidate => !chosenRatingKeys.has(candidate.ratingKey) && !chosenPaths.has(candidate.plexFilePath))
      if (track) {
        chosenRatingKeys.add(track.ratingKey)
        chosenPaths.add(track.plexFilePath)
        preview.rows.push({ item, track, included: true })
      } else {
        const existing = occupied.find(candidate => !candidate.shareIssue) ?? occupied[0]
        preview.rows.push({ item, track: existing, included: false, issue: issue ?? (tracks.length
          ? '匹配的文件已被本批其他歌曲选中' : '未找到曲名、艺人、版本和时长一致的候选') })
      }
    }
  }
}

async function saveBatch() {
  const preview = batchPreview.value
  if (!preview || batchLoading.value || acting.value || !batchReadyCount.value) return
  const choices = preview.rows.flatMap(({ item, track, included }): BatchPlexBindingChoice[] => track && included ? [{
    songId: songId(item),
    ratingKey: track.ratingKey,
    plexFilePath: track.plexFilePath,
    expectedBindingUpdatedAt: item.binding?.updatedAt ?? null,
    ...(track.owners.length ? { confirmedShareOwners: track.owners.map(({ songId, updatedAt }) => ({ songId, updatedAt })) } : {}),
  }] : [])
  acting.value = true
  preview.error = ''
  error.value = ''
  try {
    const outcomes = await api.post<BatchPlexBindingResult[]>('/match-management/bindings/batch-rebind', { sourceId: props.sourceId, choices })
    if (batchPreview.value !== preview) return
    for (const row of preview.rows) {
      const id = songId(row.item)
      if (!row.track || (!row.included && row.track.owners.length)) {
        selectedSongs.value.set(id, { item: row.item, issue: row.track ? row.track.shareIssue ?? '同一录音待确认共用' : row.issue })
      }
      else if (!row.included) selectedSongs.value.delete(id)
    }
    let saved = 0
    for (const outcome of outcomes) {
      if (outcome.error === null) {
        selectedSongs.value.delete(outcome.songId)
        saved++
      } else {
        const selected = selectedSongs.value.get(outcome.songId)
        if (selected) selected.issue = outcome.error
      }
    }
    const counts = [`已保存 ${saved} 首关联`]
    if (outcomes.length > saved) counts.push(`${outcomes.length - saved} 首保存失败`)
    const skipped = preview.rows.filter(row => !row.track || (!row.included && row.track.owners.length)).length
    if (skipped) counts.push(`${skipped} 首仍待处理`)
    notice.value = counts.join('，') + '。'
    batchPreview.value = null
    if (saved) {
      searchItemKey.value = ''
      emit('changed')
      await load()
    }
  } catch (err) {
    if (batchPreview.value === preview) preview.error = err instanceof Error ? err.message : '批量保存失败'
  } finally {
    acting.value = false
  }
}

async function validatePlex() {
  acting.value = true
  error.value = ''
  try {
    const data = await api.post<{
      valid: number
      recovered: number
      stale: number
      unbound: number
      needsReview: number
    }>('/match-management/validate', { sourceId: props.sourceId })
    const review = data.needsReview ? `，${data.needsReview} 条需核对录音` : ''
    notice.value = `Plex 核对完成：${data.valid} 条文件有效，${data.recovered} 条已重新对上文件，${data.stale} 条失效，${data.unbound} 首还没有关联${review}。`
    emit('changed')
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Plex 核对失败'
  } finally {
    acting.value = false
  }
}
async function validateBinding(item: MatchOverviewItem) {
  if (acting.value) return
  acting.value = true
  const id = songId(item)
  validatingId.value = id
  error.value = ''
  try {
    const data = await api.post<{ valid: number; recovered: number; stale: number; unbound: number; needsReview: number }>(
      '/match-management/validate',
      { sourceId: props.sourceId, songIds: [id] },
    )
    const outcome = data.needsReview
      ? '文件仍可用，录音信息有差异，请核对当前关联'
      : data.recovered
      ? '已按新路径重新对上文件'
      : data.valid
        ? 'Plex 里的文件仍然有效'
        : data.stale
          ? '当前无法唯一确认这份媒体，请重新选择或下载'
          : '这首歌还没有关联'
    notice.value = `核对完成：${outcome}。`
    emit('changed')
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '核对失败'
  } finally {
    validatingId.value = null
    acting.value = false
  }
}
async function searchPlex(item: MatchOverviewItem) {
  const key = itemKey(item)
  searchItemKey.value = key
  searchResults.value = []
  searching.value = true
  try {
    const data = await api.get<{ tracks: PlexSearchTrack[] }>('/match-management/plex-search', { title: item.target.title })
    if (searchItemKey.value === key) searchResults.value = data.tracks
  } catch (err) {
    if (searchItemKey.value === key) error.value = err instanceof Error ? err.message : 'Plex 搜索失败'
  } finally {
    if (searchItemKey.value === key) searching.value = false
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
      notice.value = '新的关联已保存；启用中的收藏已排队更新，暂停的收藏要手动同步一次。'
      feedback.success('新的关联已保存', '启用中的收藏已排队更新，暂停的收藏要手动同步一次。')
    } else if (action.kind === 'download') {
      await api.post(`/match-management/bindings/${songId(action.item)}/download`, {expectedBindingUpdatedAt:action.item.binding?.updatedAt??null})
      notice.value = '已安排下载；完成前继续使用原文件和原关联，暂停的收藏要手动同步一次。'
    } else {
      await api.post(`/match-management/bindings/${songId(action.item)}/unbind`, {
        expectedBindingUpdatedAt: action.item.binding?.updatedAt,
        mode: 'reevaluate',
        sourceId: orphaned.value ? undefined : props.sourceId,
      })
      notice.value = '已停止使用现在的关联；下次同步会重新为这首歌挑选或下载媒体。'
      feedback.success('已停止使用现在的关联', '下次同步会重新为这首歌挑选或下载媒体。')
    }
    pendingAction.value = null
    searchItemKey.value = ''
    emit('changed')
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '关联更新失败'
  } finally {
    acting.value = false
  }
}

watch([() => props.sourceId, () => props.targetSongId], ([, targetSongId]) => {
  search.value = targetSongId === undefined ? '' : String(targetSongId)
  state.value = ''
  exactState.value = ''
  scoredOnly.value = false
  searchItemKey.value = ''
  searching.value = false
  pendingAction.value = null
  hasSnapshot.value = null
  notice.value = ''
  page.value = 1
  result.value = { ...result.value, items: [], total: 0, page: 1 }
  void load(1)
}, { immediate: true })
const { run: refreshAfterMediaChange } = useThrottleFn(() => { void load() }, 1000)
const mediaSubscriptions: Array<() => void> = []
onMounted(() => {
  if (orphaned.value) return
  mediaSubscriptions.push(sseSubscribe('song-progress', (event) => {
    if (event.sourceId === props.sourceId && (event.status === 'done' || event.status === 'failed')) refreshAfterMediaChange()
  }), sseSubscribe('media-binding-update', (event) => {
    if (Array.isArray(event.sourceIds) && event.sourceIds.includes(props.sourceId)) refreshAfterMediaChange()
  }))
})
onUnmounted(() => {
  batchPreview.value = null
  mediaSubscriptions.forEach(unsubscribe => unsubscribe())
})
</script>

<style scoped>
.source-media { display: grid; gap: var(--space-3_5); min-width: 0; }
.source-media__header, .source-media__filters { display: flex; align-items: center; }
.source-media__header { justify-content: space-between; gap: var(--space-4); }
.source-media__header div { min-width: 0; }
.source-media__header p { margin: var(--space-0_5) 0 0; color: var(--text-muted); font-size: var(--text-xs); line-height: var(--body-leading); }
.source-media__filters { flex-wrap: wrap; gap: var(--space-2); }
.source-media__filter { width: 10rem; }
.source-media__search { position: relative; display: block; flex: 1; min-width: 10rem; }
.source-media__search svg { position: absolute; left: .7rem; top: 50%; z-index: 1; transform: translateY(-50%); color: var(--text-muted); }
.source-media__search input { width: 100%; padding-left: var(--space-8); }
.source-media__scored { display: inline-flex; width: max-content; align-items: center; gap: var(--space-2); color: var(--text-secondary); font-size: var(--text-xs); line-height: 1; cursor: pointer; }
.source-media__batch { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); color: var(--text-secondary); font-size: var(--text-sm); }
.source-media__check { display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--control-height); flex-shrink: 0; cursor: pointer; }
.source-media__check--song { justify-content: center; min-width: var(--space-6); }
.source-media__batch-preview { display: grid; gap: var(--space-3); color: var(--text-secondary); font-size: var(--text-sm); }
.source-media__batch-preview li { padding: var(--space-3) 0; border-top: 1px solid var(--border-primary); }
.source-media__batch-occupied { display: grid; gap: var(--space-1); margin-top: var(--space-2); color: var(--text-muted); }
.source-media__batch-occupied p { margin: 0; }
.source-media__batch-preview strong { color: var(--text-primary); }
.source-media__batch-choice { display: flex; align-items: flex-start; gap: var(--space-2); margin-top: var(--space-1); color: var(--text-muted); cursor: pointer; }
.source-media__batch-choice > span { display: grid; min-width: 0; }
.source-media__batch-choice input { margin-top: var(--space-0_5); }
.source-media__list { display: grid; gap: var(--space-2); }
.source-media__row { display: grid; grid-template-columns: minmax(0, 0.75fr) minmax(0, 2.25fr) max-content; align-items: center; gap: var(--space-4); padding: var(--space-4); border: 1px solid var(--border-primary); border-radius: var(--radius-lg); background: var(--bg-surface); min-width: 0; }
.source-media__target { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.source-media__target img { width: var(--space-20); height: var(--space-20); flex: none; border-radius: var(--radius-md); background: var(--bg-hover); object-fit: cover; }
.source-media__target div, .source-media__binding { display: grid; gap: var(--space-0_5); min-width: 0; }
.source-media__target strong, .source-media__target span, .source-media__binding strong, .source-media__binding small, .source-media__path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-media__target strong, .source-media__binding strong { color: var(--text-primary); font-size: var(--text-xs); }
.source-media__target span, .source-media__binding small { color: var(--text-muted); font-size: var(--text-xs); }
.source-media__reason { color: var(--warning); font-size: var(--text-xs); line-height: var(--body-leading); }
.source-media__path { color: var(--text-muted); font-size: var(--text-xs); }
.source-media__path em { margin-right: var(--space-1_5); color: var(--text-secondary); font-style: normal; font-weight: var(--font-weight-semibold); }
.source-media__state { width: max-content; color: var(--text-secondary); font-size: var(--text-xs); }
.source-media__state--matched { color: var(--success); }
.source-media__state--awaiting_manual, .source-media__state--binding_review, .source-media__state--binding_stale, .source-media__state--sync_failed, .source-media__state--copyright_restricted, .source-media__state--retry_paused { color: var(--warning); }
.source-media__actions { display: grid; grid-template-columns: repeat(2, 6rem); align-content: center; gap: var(--space-2); }
.source-media__actions :deep(.action-hint) { width: 100%; }
.source-media__actions .btn { width: 100%; }
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
  .source-media__search { width: 100%; min-width: 0; }
  .source-media__row { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  .source-media__target strong, .source-media__target span, .source-media__binding strong, .source-media__binding small, .source-media__path { overflow: visible; white-space: normal; overflow-wrap: anywhere; }
  .source-media__actions { grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
}
</style>
