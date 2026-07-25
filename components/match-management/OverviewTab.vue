<template>
  <section class="overview-tab space-y-4" :aria-busy="loading">
    <div class="section-card overview-toolbar">
      <label>
        <span>歌单范围</span>
        <select v-model="sourceId" class="form-input" @change="changeSource">
          <option v-for="source in sources" :key="source.id" :value="source.id">
            {{ source.name }}{{ source.requiresMatchReconcile ? ' · 待对齐' : '' }}
          </option>
          <option value="orphaned">未被当前歌单引用</option>
        </select>
      </label>
      <label>
        <span>匹配状态</span>
        <select v-model="state" class="form-input" @change="applyFilters">
          <option value="">全部当前目标</option>
          <option v-for="option in stateOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="overview-search">
        <span>搜索</span>
        <div>
          <AppIcon name="search" :size="14" />
          <input v-model="search" class="form-input" placeholder="标题、艺人、专辑、ID 或路径" @keyup.enter="applyFilters">
        </div>
      </label>
      <label class="overview-removed">
        <input v-model="includeRemoved" type="checkbox" @change="applyFilters">
        <span>显示已退出目标</span>
      </label>
    </div>

    <div class="section-card overview-actions">
      <div>
        <strong>{{ result.total }} 首</strong>
        <span>{{ selected.size ? `已选 ${selected.size} 首` : '可批量验证 Plex 状态' }}</span>
      </div>
      <button class="btn btn-secondary btn-sm" :disabled="sourceId === 'orphaned' || acting" @click="refreshTarget">
        <AppIcon name="refresh" :size="14" />
        仅刷新目标清单
      </button>
      <button class="btn btn-secondary btn-sm" :disabled="acting || (!selected.size && !sourceId)" @click="validateBindings">
        <AppIcon name="checkCircle" :size="14" />
        {{ selected.size ? `验证所选 ${selected.size} 首` : '立即验证整个歌单' }}
      </button>
    </div>

    <div v-if="notice" class="section-card overview-notice" role="status">
      <AppIcon name="checkCircle" :size="15" />
      <span>{{ notice }}</span>
      <NuxtLink
        v-if="affectedAfterMutation.length"
        class="btn btn-secondary btn-xs"
        :to="{ path: '/sync-sources', query: { source: affectedAfterMutation[0]?.id } }"
      >
        前往同步源
      </NuxtLink>
      <button class="btn btn-ghost btn-xs" @click="clearNotice">关闭</button>
    </div>
    <div v-if="error" class="section-card overview-error" role="alert">
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-sm" @click="load">重试</button>
    </div>
    <div v-else-if="loading && !result.items.length" class="section-card p-10 text-center text-muted">加载匹配总览…</div>
    <EmptyState
      v-else-if="!result.items.length"
      title="当前范围没有歌曲"
      description="可切换筛选条件，或刷新网易云目标清单。孤立绑定只包含未被任何当前歌单引用的身份。"
    />

    <div v-else class="section-card overview-table-wrap">
      <table class="overview-table">
        <thead>
          <tr>
            <th class="overview-check">
              <input
                type="checkbox"
                :checked="allSelected"
                :indeterminate.prop="someSelected"
                aria-label="选择本页全部歌曲"
                @change="toggleAll"
              >
            </th>
            <th>网易云目标</th>
            <th>全局绑定</th>
            <th>Plex 对齐</th>
            <th>证据与验证</th>
            <th><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="item in result.items" :key="itemKey(item)">
            <tr>
              <td class="overview-check" data-label="选择">
                <input
                  type="checkbox"
                  :checked="selected.has(songId(item))"
                  :aria-label="`选择 ${item.target.title || `歌曲 ${songId(item)}`}`"
                  @change="toggle(songId(item))"
                >
              </td>
              <td class="overview-target-cell" data-label="网易云目标">
                <div class="overview-target">
                  <img
                    v-if="item.target.coverUrl"
                    :src="item.target.coverUrl"
                    alt=""
                    loading="lazy"
                    width="40"
                    height="40"
                  >
                  <div>
                    <strong>{{ item.target.title || `网易云歌曲 #${songId(item)}` }}</strong>
                    <span>{{ item.target.artists.join('、') || '未知艺人' }}</span>
                    <small>{{ item.target.albumName || `歌曲 ID ${songId(item)}` }}</small>
                    <small v-if="item.target.metadataSource === 'review_evidence'" class="overview-metadata-source">
                      来自历史审核证据
                    </small>
                    <small v-else-if="item.target.metadataSource === 'unknown'" class="overview-metadata-source overview-metadata-source--warning">
                      目标元数据未刷新
                    </small>
                  </div>
                </div>
              </td>
              <td data-label="全局绑定">
                <strong>{{ item.binding?.plexRatingKey ? `Plex #${item.binding.plexRatingKey}` : '未建立' }}</strong>
                <span class="path">{{ item.binding?.plexRelativePath || '尚无强身份路径' }}</span>
              </td>
              <td data-label="Plex 对齐">
                <span class="state-pill" :class="`state-pill--${item.state}`">{{ stateLabel(item.state) }}</span>
                <small v-if="item.occurrence">{{ alignmentLabel(item.occurrence.alignmentStatus) }}</small>
              </td>
              <td data-label="证据与验证">
                <strong>{{ evidenceLabel(item.binding?.bindingMethod) }}</strong>
                <span
                  v-if="item.localMedia"
                  class="media-origin"
                  :class="[
                    `media-origin--${item.localMedia.ownership}`,
                    item.localMedia.status !== 'active' ? 'media-origin--warning' : '',
                  ]"
                >
                  {{ mediaOriginLabel(item) }}
                </span>
                <span>{{ item.binding?.lastVerifiedAt ? relativeTime(item.binding.lastVerifiedAt) : '从未验证' }}</span>
                <small v-if="item.pendingReviewCount">{{ item.pendingReviewCount }} 个候选待审核</small>
              </td>
              <td class="overview-row-action" data-label="操作">
                <div class="overview-row-buttons">
                  <button
                    class="btn btn-secondary btn-xs"
                    :disabled="acting || !item.target.title"
                    :title="item.target.title ? '搜索 Plex 库并选择新的全局绑定' : '请先刷新网易云目标清单'"
                    @click="searchPlex(item)"
                  >
                    <AppIcon name="search" :size="13" />
                    重新匹配
                  </button>
                  <button
                    class="btn btn-ghost btn-xs"
                    :aria-expanded="expanded === itemKey(item)"
                    @click="toggleExpanded(item)"
                  >
                    {{ expanded === itemKey(item) ? '收起' : '详情' }}
                    <AppIcon :name="expanded === itemKey(item) ? 'chevronsUp' : 'chevronDown'" :size="13" />
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="expanded === itemKey(item)" class="overview-detail-row">
              <td colspan="6">
                <div class="overview-detail">
                  <dl>
                    <div><dt>网易云 ID</dt><dd>{{ songId(item) }}</dd></div>
                    <div><dt>歌单位置</dt><dd>{{ item.occurrence ? item.occurrence.position + 1 : '—' }}</dd></div>
                    <div><dt>MusicBrainz recording</dt><dd class="path">{{ item.binding?.mbRecordingId || '无' }}</dd></div>
                    <div><dt>最后 run</dt><dd>{{ item.occurrence?.lastRunId || '无历史' }}</dd></div>
                    <div><dt>受影响歌单</dt><dd>{{ affectedLabel(item) }}</dd></div>
                    <div><dt>绑定版本</dt><dd class="path">{{ item.binding?.updatedAt || '无' }}</dd></div>
                    <div><dt>媒体来源</dt><dd>{{ mediaOriginLabel(item) }}</dd></div>
                    <div><dt>本地资产路径</dt><dd class="path">{{ item.localMedia?.filePath || '无持久资产记录' }}</dd></div>
                  </dl>
                  <details v-if="item.occurrence?.matchTrace || item.occurrence?.lastError">
                    <summary>匹配链路与错误</summary>
                    <pre>{{ JSON.stringify({ matchTrace: item.occurrence.matchTrace, error: item.occurrence.lastError }, null, 2) }}</pre>
                  </details>
                  <div class="overview-detail-actions">
                    <button class="btn btn-secondary btn-sm" :disabled="acting" @click="searchPlex(item)">
                      <AppIcon name="search" :size="14" />
                      {{ searchItemKey === itemKey(item) ? '重新搜索 Plex' : '搜索并重绑' }}
                    </button>
                    <template v-if="item.binding?.status === 'active'">
                      <button class="btn btn-ghost btn-sm" :disabled="acting" @click="confirmUnbind(item, 'reevaluate')">
                        解绑并重新评估
                      </button>
                      <button class="btn btn-ghost btn-sm text-danger" :disabled="acting" @click="confirmUnbind(item, 'exclude_current')">
                        排除此文件
                      </button>
                    </template>
                  </div>
                  <div v-if="searchItemKey === itemKey(item)" class="overview-search-results">
                    <p>{{ searching ? '正在搜索 Plex…' : `找到 ${searchResults.length} 个候选` }}</p>
                    <article v-for="track in searchResults" :key="track.ratingKey">
                      <div>
                        <strong>{{ track.title }}</strong>
                        <span>{{ track.artist || '未知艺人' }} · {{ track.album || '未知专辑' }}</span>
                        <small class="path">{{ track.plexFilePath || '没有媒体路径' }}</small>
                      </div>
                      <button class="btn btn-primary btn-sm" :disabled="!track.plexFilePath" @click="confirmRebind(item, track)">
                        选择此曲
                      </button>
                    </article>
                    <p v-if="!searching && !searchResults.length">没有找到可绑定候选。</p>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <nav v-if="result.total > result.pageSize" class="section-card overview-pagination" aria-label="匹配总览分页">
      <button class="btn btn-secondary btn-sm" :disabled="result.page <= 1 || loading" @click="goPage(result.page - 1)">上一页</button>
      <span>第 {{ result.page }} / {{ Math.ceil(result.total / result.pageSize) }} 页</span>
      <button class="btn btn-secondary btn-sm" :disabled="result.page >= Math.ceil(result.total / result.pageSize) || loading" @click="goPage(result.page + 1)">下一页</button>
    </nav>

    <ConfirmDialog
      :visible="Boolean(pendingAction)"
      :title="pendingTitle"
      :message="pendingMessage"
      :confirm-label="pendingAction?.kind === 'exclude_current' ? '排除并重匹配' : pendingAction?.kind === 'reevaluate' ? '解绑并重新评估' : '保存全局重绑'"
      :variant="pendingAction?.kind === 'exclude_current' ? 'danger' : 'primary'"
      :busy="acting"
      @confirm="executePendingAction"
      @cancel="pendingAction = null"
    />
  </section>
</template>

<script setup lang="ts">
import type { MatchOverviewItem, MatchOverviewPage, MatchOverviewState } from '~~/types/match-management'

interface SourceOption { id: string; name: string; neteasePlaylistName: string; requiresMatchReconcile: boolean }
interface PlexSearchTrack { ratingKey: string; title: string; artist: string; album: string; plexFilePath: string | null }
type PendingAction =
  | { kind: 'rebind'; item: MatchOverviewItem; track: PlexSearchTrack }
  | { kind: 'reevaluate' | 'exclude_current'; item: MatchOverviewItem }

const props = defineProps<{ initialSourceId?: string }>()
const emit = defineEmits<{ sourceChange: [value: string] }>()
const api = useApi()
const route = useRoute()
const router = useRouter()
const sources = ref<SourceOption[]>([])
const sourceId = ref(props.initialSourceId || '')
const state = ref<MatchOverviewState | ''>(typeof route.query.state === 'string' ? route.query.state as MatchOverviewState : '')
const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const includeRemoved = ref(route.query.removed === '1')
const page = ref(Number(route.query.page) || 1)
const result = ref<MatchOverviewPage>({ items: [], total: 0, page: 1, pageSize: 50, staleAfterMinutes: 10 })
const loading = ref(false)
const acting = ref(false)
const error = ref('')
const notice = ref('')
const affectedAfterMutation = ref<Array<{ id: string; name: string }>>([])
const expanded = ref('')
const selected = ref(new Set<number>())
const searchItemKey = ref('')
const searching = ref(false)
const searchResults = ref<PlexSearchTrack[]>([])
const pendingAction = ref<PendingAction | null>(null)
const autoValidatedScopes = new Set<string>()

const stateOptions: Array<{ value: MatchOverviewState; label: string }> = [
  { value: 'matched', label: '已匹配' },
  { value: 'pending_alignment', label: '待对齐' },
  { value: 'historical_unverified', label: '历史待验证' },
  { value: 'pending_review', label: '待审核' },
  { value: 'unmatched', label: '未匹配' },
  { value: 'binding_stale', label: '绑定失效' },
  { value: 'copyright_restricted', label: '版权受限' },
  { value: 'sync_failed', label: '同步失败' },
  { value: 'retry_paused', label: '暂停重试' },
  { value: 'removed', label: '已退出目标' },
]
const allSelected = computed(() => result.value.items.length > 0 && result.value.items.every(item => selected.value.has(songId(item))))
const someSelected = computed(() => result.value.items.some(item => selected.value.has(songId(item))) && !allSelected.value)
const pendingTitle = computed(() => pendingAction.value?.kind === 'rebind'
  ? '确认全局重绑'
  : pendingAction.value?.kind === 'exclude_current' ? '排除此 Plex 文件' : '解绑并重新评估')
const pendingMessage = computed(() => {
  const action = pendingAction.value
  if (!action) return ''
  const item = action.item
  const impact = item.affectedSources.map(source => source.name).join('、') || '无当前歌单'
  if (action.kind === 'rebind') {
    return `将歌曲“${item.target.title || songId(item)}”全局重绑到 Plex #${action.track.ratingKey}。受影响歌单（${item.affectedSources.length}）：${impact}。本操作不会立即修改 Plex，下一次同步才会对齐。`
  }
  return action.kind === 'exclude_current'
    ? `当前文件将被记录为拒绝候选，不会再次被自动选中；${impact} 将标记为待对齐。`
    : `系统会解除当前绑定并允许再次选择同一文件；${impact} 将标记为待对齐。`
})

function songId(item: MatchOverviewItem) { return item.target.neteaseSongId }
function itemKey(item: MatchOverviewItem) { return item.occurrence?.id ?? `orphan-${songId(item)}` }
function stateLabel(value: MatchOverviewState) {
  return stateOptions.find(option => option.value === value)?.label ?? value
}
function alignmentLabel(value: string) {
  return ({ aligned: 'Plex 已读回确认', pending: '等待下次同步', missing: 'Plex 未找到', unknown: '历史数据未验证' } as Record<string, string>)[value] ?? value
}
function evidenceLabel(value?: string) {
  return ({ path: '精确路径', mb_recording: 'MusicBrainz recording', metadata: '高置信元数据', manual: '人工绑定', migrated: '自动迁移' } as Record<string, string>)[value ?? ''] ?? '无强证据'
}
function mediaOriginLabel(item: MatchOverviewItem) {
  const media = item.localMedia
  if (!media) return '未记录本地资产'
  if (media.status === 'replaced') return '托管文件已变化'
  if (media.status === 'missing') return media.ownership === 'managed' ? '托管文件缺失' : '外部文件缺失'
  if (media.ownership === 'managed') return 'YunPlex 托管'
  return media.provenance === 'computed' ? '外部文件 · 路径推算' : '外部文件'
}
function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000))
  if (minutes < 1) return '刚刚验证'
  if (minutes < 60) return `${minutes} 分钟前验证`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前验证`
  return new Date(value).toLocaleString()
}
function affectedLabel(item: MatchOverviewItem) {
  return item.affectedSources.length ? item.affectedSources.map(source => source.name).join('、') : '未被当前歌单引用'
}
function clearNotice() {
  notice.value = ''
  affectedAfterMutation.value = []
}
function syncUrl() {
  router.replace({ query: {
    ...route.query,
    source: sourceId.value || undefined,
    state: state.value || undefined,
    search: search.value || undefined,
    removed: includeRemoved.value ? '1' : undefined,
    page: page.value > 1 ? String(page.value) : undefined,
  } })
}
async function loadSources() {
  sources.value = await api.get<SourceOption[]>('/playlist-sources')
  if (!sourceId.value) sourceId.value = sources.value[0]?.id || 'orphaned'
  emit('sourceChange', sourceId.value)
}
async function load() {
  if (!sourceId.value) return
  loading.value = true
  error.value = ''
  try {
    result.value = await api.get<MatchOverviewPage>('/match-management/overview', {
      sourceId: sourceId.value,
      state: state.value,
      search: search.value,
      includeRemoved: includeRemoved.value ? '1' : '0',
      page: String(page.value),
      pageSize: '50',
    })
    selected.value = new Set([...selected.value].filter(id => result.value.items.some(item => songId(item) === id)))
    syncUrl()
    void validateStaleBindingsInBackground()
  } catch (value) {
    error.value = value instanceof Error ? value.message : '加载匹配总览失败'
  } finally {
    loading.value = false
  }
}
async function validateStaleBindingsInBackground() {
  const staleCutoff = Date.now() - result.value.staleAfterMinutes * 60_000
  const staleSongIds = result.value.items
    .filter((item) => {
      if (item.binding?.status !== 'active') return false
      const verifiedAt = item.binding.lastVerifiedAt ? Date.parse(item.binding.lastVerifiedAt) : 0
      return !Number.isFinite(verifiedAt) || verifiedAt < staleCutoff
    })
    .map(songId)
    .filter(id => id > 0)
  if (!staleSongIds.length) return

  const scopeKey = `${sourceId.value}:${[...staleSongIds].sort((a, b) => a - b).join(',')}`
  if (autoValidatedScopes.has(scopeKey)) return
  autoValidatedScopes.add(scopeKey)
  try {
    await api.post('/match-management/validate', {
      sourceId: sourceId.value === 'orphaned' ? undefined : sourceId.value,
      songIds: staleSongIds,
    })
    await load()
  } catch {
    // Keep cached state visible. A failed background check must not weaken deletion protection.
  }
}
async function changeSource() {
  page.value = 1
  selected.value = new Set()
  emit('sourceChange', sourceId.value)
  await load()
}
async function applyFilters() { page.value = 1; await load() }
async function goPage(value: number) { page.value = value; await load() }
function toggle(id: number) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(result.value.items.map(songId))
}
function toggleExpanded(item: MatchOverviewItem) {
  expanded.value = expanded.value === itemKey(item) ? '' : itemKey(item)
}
async function refreshTarget() {
  if (sourceId.value === 'orphaned') return
  acting.value = true
  try {
    const data = await api.post<{ trackCount: number }>(`/match-management/sources/${sourceId.value}/refresh-target`)
    notice.value = `目标清单已刷新，共 ${data.trackCount} 首；Plex 未被修改。`
    await load()
  } catch (value) { error.value = value instanceof Error ? value.message : '刷新失败' } finally { acting.value = false }
}
async function validateBindings() {
  acting.value = true
  try {
    const data = await api.post<{
      requested: number
      valid: number
      recovered: number
      stale: number
      unbound: number
      aligned: number
      pendingAlignment: number
      missingAlignment: number
    }>(
      '/match-management/validate',
      { sourceId: sourceId.value === 'orphaned' ? undefined : sourceId.value, songIds: selected.value.size ? [...selected.value] : undefined },
    )
    const alignmentSummary = sourceId.value === 'orphaned'
      ? ''
      : `；歌单已对齐 ${data.aligned}，待对齐 ${data.pendingAlignment}，缺少绑定 ${data.missingAlignment}`
    notice.value = `已验证 ${data.requested} 首：有效 ${data.valid}，路径恢复 ${data.recovered}，失效 ${data.stale}，未绑定 ${data.unbound}${alignmentSummary}。`
    await load()
  } catch (value) { error.value = value instanceof Error ? value.message : '验证失败' } finally { acting.value = false }
}
async function searchPlex(item: MatchOverviewItem) {
  expanded.value = itemKey(item)
  searchItemKey.value = itemKey(item)
  searching.value = true
  searchResults.value = []
  try {
    const data = await api.get<{ tracks: PlexSearchTrack[] }>('/match-reviews/plex-search', { title: item.target.title })
    searchResults.value = data.tracks
  } catch (value) { error.value = value instanceof Error ? value.message : '搜索 Plex 失败' } finally { searching.value = false }
}
function confirmRebind(item: MatchOverviewItem, track: PlexSearchTrack) {
  pendingAction.value = { kind: 'rebind', item, track }
}
function confirmUnbind(item: MatchOverviewItem, kind: 'reevaluate' | 'exclude_current') {
  pendingAction.value = { kind, item }
}
async function executePendingAction() {
  const action = pendingAction.value
  if (!action?.item.binding && action?.kind !== 'rebind') return
  acting.value = true
  try {
    if (action.kind === 'rebind') {
      const data = await api.post<{ affectedSources: Array<{ id: string; name: string }> }>(`/match-management/bindings/${songId(action.item)}/rebind`, {
        ratingKey: action.track.ratingKey,
        expectedBindingUpdatedAt: action.item.binding?.updatedAt ?? null,
        sourceId: sourceId.value === 'orphaned' ? undefined : sourceId.value,
      })
      affectedAfterMutation.value = data.affectedSources
      notice.value = '全局绑定已保存；受影响歌单已标记为待对齐。'
    } else {
      const data = await api.post<{ affectedSources: Array<{ id: string; name: string }> }>(`/match-management/bindings/${songId(action.item)}/unbind`, {
        expectedBindingUpdatedAt: action.item.binding!.updatedAt,
        mode: action.kind,
        sourceId: sourceId.value === 'orphaned' ? undefined : sourceId.value,
      })
      affectedAfterMutation.value = data.affectedSources
      notice.value = action.kind === 'exclude_current' ? '已排除当前文件并等待重新匹配。' : '已解绑并允许系统重新评估。'
    }
    pendingAction.value = null
    searchItemKey.value = ''
    await load()
  } catch (value) { error.value = value instanceof Error ? value.message : '身份操作失败' } finally { acting.value = false }
}

onMounted(async () => { await loadSources(); await load() })
</script>

<style scoped>
.overview-toolbar { display: grid; grid-template-columns: minmax(14rem, 1.2fr) minmax(11rem, .8fr) minmax(15rem, 1.35fr) auto; gap: .75rem; align-items: end; padding: 1rem; }
.overview-toolbar label { display: flex; min-width: 0; flex-direction: column; gap: .35rem; color: var(--text-muted-deep); font-size: .7rem; font-weight: 650; }
.overview-search > div { position: relative; }
.overview-search svg { position: absolute; z-index: 1; top: 50%; left: .7rem; transform: translateY(-50%); }
.overview-search input { width: 100%; padding-left: 2rem; }
.overview-removed { min-height: 2.75rem; flex-direction: row !important; align-items: center; padding-inline: .4rem; white-space: nowrap; }
.overview-removed input, .overview-check input { width: 1rem; height: 1rem; accent-color: var(--accent); }
.overview-actions { display: flex; align-items: center; justify-content: flex-end; gap: .55rem; padding: .75rem 1rem; }
.overview-actions > div { display: flex; margin-right: auto; flex-direction: column; font-size: .7rem; color: var(--text-muted-deep); }
.overview-actions strong { font-size: .9rem; color: var(--text-primary); }
.overview-notice, .overview-error { display: flex; align-items: center; gap: .6rem; padding: .8rem 1rem; font-size: .76rem; }
.overview-notice { color: var(--success); }
.overview-error { justify-content: space-between; color: var(--danger); }
.overview-notice span { margin-right: auto; }
.overview-table-wrap { overflow-x: auto; }
.overview-table { width: 100%; border-collapse: collapse; font-size: .75rem; }
.overview-table th { padding: .7rem .65rem; border-bottom: 1px solid var(--border-primary); color: var(--text-muted-deep); font-size: .66rem; text-align: left; text-transform: uppercase; letter-spacing: .04em; }
.overview-table td { min-width: 9rem; padding: .75rem .65rem; border-bottom: 1px solid var(--border-primary); vertical-align: top; }
.overview-table td > strong, .overview-table td > span, .overview-table td > small { display: block; }
.overview-table td > strong { color: var(--text-primary); font-size: .78rem; }
.overview-table td > span, .overview-table td > small { margin-top: .15rem; color: var(--text-muted-deep); font-size: .68rem; }
.overview-table .overview-check { width: 2.5rem; min-width: 2.5rem; text-align: center; }
.overview-target { display: flex; min-width: 0; align-items: flex-start; gap: .55rem; }
.overview-target img { width: 2.5rem; height: 2.5rem; flex: 0 0 auto; border-radius: .38rem; object-fit: cover; background: var(--bg-hover); }
.overview-target > div { display: flex; min-width: 0; flex-direction: column; }
.overview-target strong { color: var(--text-primary); font-size: .78rem; }
.overview-target span, .overview-target small { margin-top: .12rem; color: var(--text-muted-deep); font-size: .67rem; }
.overview-metadata-source { width: max-content; padding: .08rem .28rem; border-radius: .25rem; color: var(--accent) !important; background: var(--accent-muted); }
.overview-metadata-source--warning { color: var(--warning) !important; background: color-mix(in srgb, var(--warning) 12%, transparent); }
.overview-row-action { width: 11rem; min-width: 11rem !important; text-align: right; }
.overview-row-buttons { display: flex; justify-content: flex-end; gap: .3rem; }
.path { max-width: 22rem; overflow-wrap: anywhere; font-family: var(--font-mono, monospace); }
.state-pill { display: inline-flex !important; width: max-content; padding: .18rem .42rem; border-radius: .38rem; background: var(--bg-hover); color: var(--text-muted) !important; font-weight: 700; }
.state-pill--matched { background: color-mix(in srgb, var(--success) 13%, transparent); color: var(--success) !important; }
.state-pill--pending_alignment, .state-pill--pending_review { background: color-mix(in srgb, var(--warning) 13%, transparent); color: var(--warning) !important; }
.state-pill--historical_unverified { background: color-mix(in srgb, var(--text-muted-deep) 12%, transparent); color: var(--text-muted-deep) !important; }
.state-pill--binding_stale, .state-pill--sync_failed { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger) !important; }
.media-origin { display: inline-flex !important; width: max-content; padding: .13rem .36rem; border-radius: .32rem; background: var(--bg-hover); color: var(--text-muted-deep) !important; font-weight: 700; }
.media-origin--managed { background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success) !important; }
.media-origin--warning { background: color-mix(in srgb, var(--warning) 13%, transparent); color: var(--warning) !important; }
.overview-detail-row td { padding: 0 1rem 1rem; background: color-mix(in srgb, var(--bg-app) 65%, transparent); }
.overview-detail { padding: 1rem; border: 1px solid var(--border-primary); border-radius: .65rem; }
.overview-detail dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
.overview-detail dl div { min-width: 0; }
.overview-detail dt { color: var(--text-muted-deep); font-size: .64rem; }
.overview-detail dd { margin-top: .16rem; color: var(--text-primary); font-size: .72rem; overflow-wrap: anywhere; }
.overview-detail details { margin-top: .8rem; }
.overview-detail summary { cursor: pointer; color: var(--accent); }
.overview-detail pre { max-height: 16rem; margin-top: .5rem; overflow: auto; padding: .7rem; border-radius: .5rem; background: var(--bg-app); font-size: .65rem; }
.overview-detail-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .8rem; }
.overview-search-results { margin-top: .8rem; padding-top: .65rem; border-top: 1px solid var(--border-primary); }
.overview-search-results > p { color: var(--text-muted-deep); font-size: .7rem; }
.overview-search-results article { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .65rem 0; border-bottom: 1px solid var(--border-primary); }
.overview-search-results article div { display: flex; min-width: 0; flex-direction: column; font-size: .72rem; }
.overview-search-results article span, .overview-search-results article small { color: var(--text-muted-deep); }
.overview-pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: .75rem; color: var(--text-muted); font-size: .72rem; }
@media (max-width: 900px) {
  .overview-toolbar { grid-template-columns: 1fr 1fr; }
  .overview-detail dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .overview-toolbar { grid-template-columns: 1fr; }
  .overview-actions { flex-wrap: wrap; justify-content: flex-start; }
  .overview-actions > div { width: 100%; }
  .overview-actions .btn { flex: 1 1 10rem; }
  .overview-table thead { display: none; }
  .overview-table, .overview-table tbody, .overview-table tr, .overview-table td { display: block; width: 100%; }
  .overview-table tr:not(.overview-detail-row) { position: relative; padding: .65rem 2.8rem .65rem .65rem; border-bottom: 1px solid var(--border-primary); }
  .overview-table td { min-width: 0; padding: .35rem 0; border: 0; }
  .overview-table td::before { content: attr(data-label); display: block; margin-bottom: .12rem; color: var(--text-muted-deep); font-size: .6rem; }
  .overview-table .overview-check { position: absolute; top: .7rem; right: .5rem; width: auto; min-width: 0; }
  .overview-table .overview-check::before, .overview-row-action::before { display: none; }
  .overview-row-action { width: auto; min-width: 0 !important; text-align: left; }
  .overview-row-buttons { justify-content: flex-start; }
  .overview-row-buttons .btn { min-height: 2.5rem; }
  .overview-detail-row td { padding: .7rem; }
  .overview-detail dl { grid-template-columns: 1fr; }
  .overview-search-results article { align-items: flex-start; flex-direction: column; }
  .overview-search-results .btn { width: 100%; }
}
</style>
