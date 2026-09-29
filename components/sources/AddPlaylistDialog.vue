<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center p-3 sm:items-center"
      style="background: var(--bg-overlay); backdrop-filter: blur(8px)"
      @click.self="close"
    >
      <div
        ref="dialogPanel"
        role="dialog"
        aria-modal="true"
        aria-label="添加音乐收藏"
        tabindex="-1"
        class="add-collection-dialog flex max-h-[90dvh] w-full max-w-[42rem] flex-col overflow-hidden rounded-xl border shadow-xl"
        style="background: var(--bg-surface); border-color: var(--border-primary)"
      >
        <div class="add-collection-heading">
          <div>
            <h2>添加音乐收藏</h2>
            <p>选择歌单或专辑，加入你的音乐库。</p>
          </div>
          <button class="icon-button" :disabled="saving" aria-label="关闭添加收藏" @click="close">
            <AppIcon name="close" :size="18" />
          </button>
        </div>
        <div class="add-collection-toolbar">
          <div class="add-collection-types" role="group" aria-label="收藏类型">
            <button
              v-for="t in typeTabs"
              :key="t.key"
              class="btn btn-sm"
              :class="dialogType === t.key ? 'btn-primary' : 'btn-ghost'"
              :aria-pressed="dialogType === t.key"
              :disabled="saving"
              @click="switchType(t.key)"
            >
              <AppIcon :name="t.key === 'playlist' ? 'source' : 'album'" :size="16" />{{ t.label }}
            </button>
          </div>
          <button
            class="btn btn-ghost btn-sm"
            :disabled="loading || saving"
            @click="() => (dialogType === 'playlist' ? fetchList(true) : fetchAlbums())"
          >
            <AppIcon :name="loading ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': loading }" />{{
              dialogType === 'playlist' ? '刷新歌单' : '刷新专辑'
            }}
          </button>
          <button
            class="btn btn-secondary btn-sm"
            :disabled="saving"
            :aria-pressed="manualEntry"
            :aria-label="manualEntry ? '返回收藏列表' : '直接输入资源 ID'"
            @click="manualEntry = !manualEntry"
          >
            <AppIcon :name="manualEntry ? 'list' : 'plus'" :size="14" />{{
              manualEntry ? '收藏列表' : '输入 ID'
            }}
          </button>
        </div>
        <template v-if="!error && !manualEntry">
          <div v-if="loading" class="text-sm text-muted py-12 text-center">加载列表...</div>

          <!-- Playlist tab -->
          <template v-else-if="dialogType === 'playlist'">
            <div class="overflow-y-auto flex-1 px-4 py-2 space-y-3">
              <div class="add-collection-filters">
                <label class="filter-search"><AppIcon name="search" :size="16" /><input v-model="search" type="search" class="filter-search-input" aria-label="搜索网易云歌单" placeholder="搜索歌单名、创建者或 ID" /></label>
                <div class="add-collection-filter-row"><select v-model="playlistScope" class="form-input" aria-label="歌单范围"><option value="all">全部歌单</option><option value="created">我创建的</option><option value="subscribed">收藏的</option></select><FilterChip :active="hideAdded" @click="hideAdded = !hideAdded">仅未添加</FilterChip><button v-if="playlistDialogCanClear" class="btn btn-ghost btn-sm" @click="clearPlaylistDialogFilters">清除</button></div>
              </div>
              <p class="add-collection-list-label">从网易云歌单中选择</p>
              <div v-if="!filtered.length" class="text-sm text-muted py-8 text-center">
                没有符合条件的歌单，可调整筛选或直接输入资源 ID。
              </div>
              <template v-if="created.length > 0">
                <div
                  class="flex items-center gap-2 px-1 py-1 border-l-2 cursor-pointer select-none"
                  style="border-color: var(--accent)"
                  @click="createdCollapsed = !createdCollapsed"
                >
                  <AppIcon
                    name="chevronRight"
                    :size="10"
                    class="transition-transform shrink-0"
                    :class="createdCollapsed ? '' : 'rotate-90'"
                  />
                  <span class="text-xs font-semibold" style="color: var(--text-primary)">我创建的</span>
                  <span
                    class="text-2xs px-1.5 py-0.5 rounded-full"
                    style="background: var(--accent-glow); color: var(--accent)"
                    >{{ created.length }}</span
                  >
                </div>
                <div v-show="!createdCollapsed" class="space-y-0.5">
                  <label
                    v-for="p in created"
                    :key="p.id"
                    class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border"
                    :style="{
                      borderColor: isAdded(p.id) ? 'var(--border-primary)' : 'transparent',
                      background: selectedIds.includes(p.id) ? 'var(--accent-glow)' : 'transparent',
                    }"
                    :class="isAdded(p.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'"
                  >
                    <input
                      v-model="selectedIds"
                      type="checkbox"
                      :value="p.id"
                      :disabled="isAdded(p.id)"
                      class="shrink-0 rounded"
                    />
                    <img
                      v-if="p.coverImgUrl"
                      :src="getSyncSourceCoverUrl(p.coverImgUrl)"
                      class="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                    <div
                      v-else
                      class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style="background: var(--bg-input)"
                    >
                      <AppIcon name="music" :size="16" class="text-muted-deep" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm truncate" style="color: var(--text-primary)">{{ p.name }}</p>
                      <p class="text-2xs text-muted-deep mt-0.5">
                        {{ p.trackCount }} 首{{ p.creator?.nickname ? ' · ' + p.creator.nickname : '' }}
                      </p>
                    </div>
                    <span
                      v-if="isAdded(p.id)"
                      class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0"
                      style="background: var(--bg-input)"
                      >已添加</span
                    >
                  </label>
                </div>
              </template>
              <template v-if="subscribed.length > 0">
                <div
                  class="flex items-center gap-2 px-1 py-1 border-l-2 cursor-pointer select-none"
                  style="border-color: var(--success)"
                  @click="subscribedCollapsed = !subscribedCollapsed"
                >
                  <AppIcon
                    name="chevronRight"
                    :size="10"
                    class="transition-transform shrink-0"
                    :class="subscribedCollapsed ? '' : 'rotate-90'"
                  />
                  <span class="text-xs font-semibold" style="color: var(--text-primary)">收藏的歌单</span>
                  <span
                    class="text-2xs px-1.5 py-0.5 rounded-full"
                    style="background: var(--success-soft); color: var(--success)"
                    >{{ subscribed.length }}</span
                  >
                </div>
                <div v-show="!subscribedCollapsed" class="space-y-0.5">
                  <label
                    v-for="p in subscribed"
                    :key="p.id"
                    class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border"
                    :style="{
                      borderColor: isAdded(p.id) ? 'var(--border-primary)' : 'transparent',
                      background: selectedIds.includes(p.id) ? 'var(--accent-glow)' : 'transparent',
                    }"
                    :class="isAdded(p.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'"
                  >
                    <input
                      v-model="selectedIds"
                      type="checkbox"
                      :value="p.id"
                      :disabled="isAdded(p.id)"
                      class="shrink-0 rounded"
                    />
                    <img
                      v-if="p.coverImgUrl"
                      :src="getSyncSourceCoverUrl(p.coverImgUrl)"
                      class="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                    <div
                      v-else
                      class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style="background: var(--bg-input)"
                    >
                      <AppIcon name="music" :size="16" class="text-muted-deep" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm truncate" style="color: var(--text-primary)">{{ p.name }}</p>
                      <p class="text-2xs text-muted-deep mt-0.5">
                        {{ p.trackCount }} 首{{ p.creator?.nickname ? ' · ' + p.creator.nickname : '' }}
                      </p>
                    </div>
                    <span
                      v-if="isAdded(p.id)"
                      class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0"
                      style="background: var(--bg-input)"
                      >已添加</span
                    >
                  </label>
                </div>
              </template>
            </div>
            <div v-if="hasMore" class="flex justify-center py-3 shrink-0">
              <button class="btn btn-ghost btn-sm" :disabled="loadingMore" @click="loadMore">
                {{ loadingMore ? '加载中...' : '加载更多歌单' }}
              </button>
            </div>
          </template>

          <!-- Album tab -->
          <template v-else>
            <div class="overflow-y-auto flex-1 px-4 py-2 space-y-3">
              <div class="add-collection-filters">
                <label class="filter-search"><AppIcon name="search" :size="16" /><input v-model="albumSearch" type="search" class="filter-search-input" aria-label="搜索网易云专辑" placeholder="搜索专辑、艺人、ID 或年份" /></label>
                <div class="add-collection-filter-row"><FilterChip :active="albumHideAdded" @click="albumHideAdded = !albumHideAdded">仅未添加</FilterChip><button v-if="albumDialogCanClear" class="btn btn-ghost btn-sm" @click="clearAlbumDialogFilters">清除</button></div>
              </div>
              <template v-if="filteredAlbums.length > 0">
                <div class="space-y-0.5">
                  <label
                    v-for="a in filteredAlbums"
                    :key="a.id"
                    class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border"
                    :style="{
                      borderColor: isAdded(a.id) ? 'var(--border-primary)' : 'transparent',
                      background: selectedIds.includes(a.id) ? 'var(--accent-glow)' : 'transparent',
                    }"
                    :class="isAdded(a.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'"
                  >
                    <input
                      v-model="selectedIds"
                      type="checkbox"
                      :value="a.id"
                      :disabled="isAdded(a.id)"
                      class="shrink-0 rounded"
                    />
                    <img
                      v-if="a.picUrl"
                      :src="getSyncSourceCoverUrl(a.picUrl)"
                      class="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                    <div
                      v-else
                      class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style="background: var(--bg-input)"
                    >
                      <AppIcon name="album" :size="16" class="text-muted-deep" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm truncate" style="color: var(--text-primary)">{{ a.name }}</p>
                      <p class="text-2xs text-muted-deep mt-0.5">
                        {{ a.size }} 首 · {{ a.artist?.name }} · {{ publishYear(a.publishTime) }}
                      </p>
                    </div>
                    <span
                      v-if="isAdded(a.id)"
                      class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0"
                      style="background: var(--bg-input)"
                      >已添加</span
                    >
                  </label>
                </div>
              </template>
              <div v-else class="text-sm text-muted py-12 text-center">暂无专辑</div>
            </div>
          </template>

          <!-- Footer -->
          <div
            class="flex items-center justify-between gap-3 px-5 py-3 shrink-0"
            style="border-top: 1px solid var(--border-primary); background: var(--bg-app)"
          >
            <span class="text-2xs text-muted">已选 {{ selectedIds.length }} 个</span>
            <p v-if="saveError" class="add-collection-error" role="alert">{{ saveError }}</p>
            <div class="flex gap-2">
              <button class="btn btn-secondary" :disabled="saving" @click="close">取消</button>
              <button class="btn btn-primary" :disabled="saving || selectedIds.length === 0" @click="handleAddSelected">
                {{ saving ? '添加中...' : '确认添加' }}
              </button>
            </div>
          </div>
        </template>

        <!-- Error + manual input fallback -->
        <template v-else>
          <div class="px-5 py-4 flex-1 overflow-y-auto">
            <p v-if="error" class="text-2xs text-warning mb-4">{{ error }}</p>
            <div>
              <label
                for="add-collection-resource-id"
                class="text-xs font-medium block mb-1.5"
                style="color: var(--text-primary)"
                >手动输入{{ dialogType === 'playlist' ? '歌单' : '专辑' }} ID</label
              >
              <input
                id="add-collection-resource-id"
                ref="manualInput"
                v-model="manualId"
                :disabled="saving"
                type="text"
                inputmode="numeric"
                placeholder="例如：123456789"
                class="form-input w-full"
                @keydown.enter.prevent="handleAddSingle"
              />
            </div>
          </div>
          <div
            class="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
            style="border-top: 1px solid var(--border-primary); background: var(--bg-app)"
          >
            <p v-if="saveError" class="add-collection-error" role="alert">{{ saveError }}</p>
            <button class="btn btn-secondary" :disabled="saving" @click="close">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="handleAddSingle">确认添加</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { getSyncSourceCoverUrl } from '~/composables/useSyncSourcePresentation'
import { useDialogFocus } from '~/composables/useDialogFocus'
import { countActiveFilters } from '~~/composables/useFilterQuery'

interface NeteasePlaylist {
  id: number
  name: string
  trackCount: number
  playCount: number
  coverImgUrl: string
  creator: { nickname: string; userId: number }
  subscribed: boolean
}

interface AlbumItem {
  id: number
  name: string
  size: number
  picUrl: string
  artist: { name: string }
  publishTime: number
}

const props = defineProps<{ visible: boolean; sourceIds: number[] }>()
const emit = defineEmits<{
  'update:visible': [v: boolean]
  created: [count: number]
  'created-album': [count: number]
}>()

const api = useApi()
const dialogPanel = ref<HTMLElement | null>(null)
function close() {
  if (!saving.value) emit('update:visible', false)
}
useDialogFocus(() => props.visible, dialogPanel, close)

// Dialog type tab
const dialogType = ref<'playlist' | 'album'>('playlist')
const typeTabs = [
  { key: 'playlist' as const, label: '歌单' },
  { key: 'album' as const, label: '专辑' },
]

function switchType(key: 'playlist' | 'album') {
  if (saving.value) return
  saveError.value = ''
  dialogType.value = key
  selectedIds.value = []
  search.value = ''
  manualId.value = ''
  playlistScope.value = 'all'
  hideAdded.value = false
  albumHideAdded.value = false
  if (key === 'album') {
    fetchAlbums()
    albumSearch.value = ''
  } else fetchList(true)
}

// Shared state
const loading = ref(false)
const loadingMore = ref(false)
const saving = ref(false)
const error = ref('')
const saveError = ref('')
const selectedIds = ref<number[]>([])
const manualId = ref('')
const manualEntry = ref(false)
const manualInput = ref<HTMLInputElement | null>(null)
watch(manualEntry, async (value) => {
  if (value) {
    await nextTick()
    manualInput.value?.focus()
  }
})

function isAdded(pid: number): boolean {
  return props.sourceIds.includes(pid)
}

// ── Playlist tab ──
const list = ref<NeteasePlaylist[]>([])
const offset = ref(0)
const hasMore = ref(true)
const search = ref('')
const playlistScope = ref<'all' | 'created' | 'subscribed'>('all')
const hideAdded = ref(false)
const createdCollapsed = ref(false)
const subscribedCollapsed = ref(false)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return list.value.filter((p) => {
    if (playlistScope.value === 'created' && p.subscribed) return false
    if (playlistScope.value === 'subscribed' && !p.subscribed) return false
    if (hideAdded.value && isAdded(p.id)) return false
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) || p.creator?.nickname?.toLowerCase().includes(q) || String(p.id).includes(q)
    )
  })
})
const created = computed(() => filtered.value.filter((p) => !p.subscribed))
const subscribed = computed(() => filtered.value.filter((p) => p.subscribed))
const playlistDialogActiveCount = computed(() =>
  countActiveFilters({
    search: search.value,
    scope: playlistScope.value === 'all' ? '' : playlistScope.value,
    hideAdded: hideAdded.value,
  }),
)
const playlistDialogCanClear = computed(() => playlistDialogActiveCount.value > 0)

function clearPlaylistDialogFilters() {
  search.value = ''
  playlistScope.value = 'all'
  hideAdded.value = false
}

async function fetchList(reset = true) {
  if (reset) {
    loading.value = true
    error.value = ''
    offset.value = 0
    hasMore.value = true
  }
  try {
    const items = await api.get<NeteasePlaylist[]>('/netease/playlists', { offset: String(offset.value) })
    if (reset) list.value = items
    else list.value.push(...items)
    hasMore.value = items.length >= 100
  } catch (err) {
    error.value = err instanceof Error ? err.message : '获取歌单列表失败，请检查 Cookie 配置'
    list.value = []
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true
  offset.value += 100
  try {
    const items = await api.get<NeteasePlaylist[]>('/netease/playlists', { offset: String(offset.value) })
    list.value.push(...items)
    hasMore.value = items.length >= 100
  } catch {
    /* ignore */
  } finally {
    loadingMore.value = false
  }
}

// ── Album tab ──
const albums = ref<AlbumItem[]>([])
const albumSearch = ref('')
const albumHideAdded = ref(false)
const filteredAlbums = computed(() => {
  const q = albumSearch.value.trim().toLowerCase()
  return albums.value.filter((a) => {
    if (albumHideAdded.value && isAdded(a.id)) return false
    if (!q) return true
    const year = publishYear(a.publishTime)
    return (
      a.name.toLowerCase().includes(q) ||
      a.artist?.name?.toLowerCase().includes(q) ||
      String(a.id).includes(q) ||
      year.includes(q)
    )
  })
})
const albumDialogActiveCount = computed(() =>
  countActiveFilters({
    search: albumSearch.value,
    hideAdded: albumHideAdded.value,
  }),
)
const albumDialogCanClear = computed(() => albumDialogActiveCount.value > 0)

function clearAlbumDialogFilters() {
  albumSearch.value = ''
  albumHideAdded.value = false
}

async function fetchAlbums() {
  loading.value = true
  error.value = ''
  try {
    albums.value = await api.get<AlbumItem[]>('/netease/albums')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '获取专辑列表失败，请检查 Cookie 配置'
    albums.value = []
  } finally {
    loading.value = false
  }
}

function publishYear(ts: number): string {
  if (!ts) return ''
  return new Date(ts).getFullYear().toString()
}

// ── Add actions ──
async function handleAddSelected() {
  if (saving.value || selectedIds.value.length === 0) return
  saving.value = true
  saveError.value = ''
  const isAlbum = dialogType.value === 'album'
  try {
    for (const pid of selectedIds.value) {
      const album = isAlbum ? albums.value.find((a) => a.id === pid) : null
      const playlist = !isAlbum ? list.value.find((p) => p.id === pid) : null
      await api.post('/playlist-sources', {
        neteasePlaylistId: pid,
        type: isAlbum ? 'album' : 'playlist',
        subscribed: playlist?.subscribed ?? false,
        coverUrl: album?.picUrl || playlist?.coverImgUrl || undefined,
        ...(album ? { name: album.name, artist: album.artist?.name } : {}),
      })
    }
    emit('update:visible', false)
    if (isAlbum) emit('created-album', selectedIds.value.length)
    else emit('created', selectedIds.value.length)
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : '添加同步源失败'
  } finally {
    saving.value = false
  }
}

async function handleAddSingle() {
  if (saving.value) return
  const value = manualId.value.trim(),
    id = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id <= 0) {
    saveError.value = '请输入有效的资源 ID（正整数）'
    return
  }
  saving.value = true
  saveError.value = ''
  const isAlbum = dialogType.value === 'album'
  try {
    const playlist = !isAlbum ? list.value.find((p) => p.id === id) : null
    await api.post('/playlist-sources', {
      neteasePlaylistId: id,
      type: isAlbum ? 'album' : 'playlist',
      subscribed: playlist?.subscribed ?? false,
      coverUrl: playlist?.coverImgUrl || undefined,
    })
    emit('update:visible', false)
    if (isAlbum) emit('created-album', 1)
    else emit('created', 1)
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : '添加同步源失败'
  } finally {
    saving.value = false
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      manualId.value = ''
      manualEntry.value = false
      selectedIds.value = []
      saveError.value = ''
      clearPlaylistDialogFilters()
      clearAlbumDialogFilters()
      if (dialogType.value === 'album') fetchAlbums()
      else fetchList(true)
    }
  },
)
</script>

<style scoped>
.add-collection-dialog {
  min-height: 0;
}
.add-collection-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-primary);
  flex: none;
}
.add-collection-heading p {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-top: var(--space-1_5);
}
.add-collection-error {
  color: var(--danger);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
  overflow-wrap: anywhere;
  margin-right: auto;
}
.add-collection-dialog :deep(.overflow-y-auto) {
  min-height: 0;
  overscroll-behavior: contain;
}
@media (max-width: 520px) {
  .add-collection-dialog > div:last-child {
    flex-wrap: wrap;
  }
  .add-collection-error {
    flex-basis: 100%;
  }
}
.add-collection-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-primary);
  flex: none;
}
.add-collection-types {
  display: flex;
  gap: var(--space-1);
  margin-right: auto;
}
.add-collection-list-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
.add-collection-filters { display: grid; gap: var(--space-2); }
.add-collection-filter-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.add-collection-filter-row select { width: 10rem; }
@media (max-width: 520px) {
  .add-collection-toolbar {
    padding: var(--space-3) var(--space-4);
  }
  .add-collection-toolbar > button:last-child {
    flex-basis: 100%;
  }
}
</style>
