<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)" @click.self="$emit('update:visible', false)">
      <div class="w-[520px] max-h-[80vh] max-w-[92vw] flex flex-col rounded-xl border shadow-xl overflow-hidden" style="background:var(--bg-surface);border-color:var(--border-primary)">
        <!-- Header with type tabs -->
        <div class="flex items-center justify-between px-5 py-3 shrink-0" style="border-bottom:1px solid var(--border-primary)">
          <div class="flex items-center gap-1">
            <button
              v-for="t in typeTabs" :key="t.key"
              class="px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer"
              :class="dialogType === t.key
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium'
                : 'text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'"
              @click="switchType(t.key)"
            >{{ t.label }}</button>
          </div>
          <button class="btn btn-ghost text-xs" :disabled="loading" @click="() => dialogType === 'playlist' ? fetchList(true) : fetchAlbums()">
            {{ dialogType === 'playlist' ? '刷新歌单' : '刷新专辑' }}
          </button>
        </div>

        <template v-if="!error">
          <div v-if="loading" class="text-sm text-muted py-12 text-center">加载列表...</div>

          <!-- Playlist tab -->
          <template v-else-if="dialogType === 'playlist'">
            <div class="overflow-y-auto flex-1 px-4 py-2 space-y-3">
              <input v-model="search" type="text" placeholder="搜索歌单..." class="form-input w-full text-xs" />
              <template v-if="created.length > 0">
                <div class="flex items-center gap-2 px-1 py-1 border-l-2 cursor-pointer select-none" style="border-color:var(--accent)" @click="createdCollapsed = !createdCollapsed">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" class="transition-transform shrink-0" :class="createdCollapsed ? '' : 'rotate-90'"><path d="M6 3l5 5-5 5" stroke="var(--text-secondary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <span class="text-xs font-semibold" style="color:var(--text-primary)">我创建的</span>
                  <span class="text-2xs px-1.5 py-0.5 rounded-full" style="background:var(--accent-glow);color:var(--accent)">{{ created.length }}</span>
                </div>
                <div v-show="!createdCollapsed" class="space-y-0.5">
                  <label v-for="p in created" :key="p.id" class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border" :style="{ borderColor: isAdded(p.id) ? 'var(--border-primary)' : 'transparent', background: selectedIds.includes(p.id) ? 'var(--accent-glow)' : 'transparent' }" :class="isAdded(p.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'">
                    <input v-model="selectedIds" type="checkbox" :value="p.id" :disabled="isAdded(p.id)" class="shrink-0 rounded" />
                    <img v-if="p.coverImgUrl" :src="`${p.coverImgUrl}?param=60y60`" class="w-10 h-10 rounded-lg object-cover shrink-0" />
                    <div v-else class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:var(--bg-input)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--text-tertiary)" stroke-width="1.3"/><path d="M10.5 5.5v3.8a1.8 1.8 0 01-1.8 1.8 1.8 1.8 0 01-1.8-1.8 1.8 1.8 0 013.6 0z" stroke="var(--text-tertiary)" stroke-width="1.3" stroke-linecap="round"/></svg></div>
                    <div class="flex-1 min-w-0"><p class="text-sm truncate" style="color:var(--text-primary)">{{ p.name }}</p><p class="text-2xs text-muted-deep mt-0.5">{{ p.trackCount }} 首{{ p.creator?.nickname ? ' · ' + p.creator.nickname : '' }}</p></div>
                    <span v-if="isAdded(p.id)" class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0" style="background:var(--bg-input)">已添加</span>
                  </label>
                </div>
              </template>
              <template v-if="subscribed.length > 0">
                <div class="flex items-center gap-2 px-1 py-1 border-l-2 cursor-pointer select-none" style="border-color:var(--success,#22c55e)" @click="subscribedCollapsed = !subscribedCollapsed">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" class="transition-transform shrink-0" :class="subscribedCollapsed ? '' : 'rotate-90'"><path d="M6 3l5 5-5 5" stroke="var(--text-secondary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <span class="text-xs font-semibold" style="color:var(--text-primary)">收藏的歌单</span>
                  <span class="text-2xs px-1.5 py-0.5 rounded-full" style="background:rgba(34,197,94,0.12);color:var(--success,#22c55e)">{{ subscribed.length }}</span>
                </div>
                <div v-show="!subscribedCollapsed" class="space-y-0.5">
                  <label v-for="p in subscribed" :key="p.id" class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border" :style="{ borderColor: isAdded(p.id) ? 'var(--border-primary)' : 'transparent', background: selectedIds.includes(p.id) ? 'var(--accent-glow)' : 'transparent' }" :class="isAdded(p.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'">
                    <input v-model="selectedIds" type="checkbox" :value="p.id" :disabled="isAdded(p.id)" class="shrink-0 rounded" />
                    <img v-if="p.coverImgUrl" :src="`${p.coverImgUrl}?param=60y60`" class="w-10 h-10 rounded-lg object-cover shrink-0" />
                    <div v-else class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:var(--bg-input)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--text-tertiary)" stroke-width="1.3"/><path d="M10.5 5.5v3.8a1.8 1.8 0 01-1.8 1.8 1.8 1.8 0 01-1.8-1.8 1.8 1.8 0 013.6 0z" stroke="var(--text-tertiary)" stroke-width="1.3" stroke-linecap="round"/></svg></div>
                    <div class="flex-1 min-w-0"><p class="text-sm truncate" style="color:var(--text-primary)">{{ p.name }}</p><p class="text-2xs text-muted-deep mt-0.5">{{ p.trackCount }} 首{{ p.creator?.nickname ? ' · ' + p.creator.nickname : '' }}</p></div>
                    <span v-if="isAdded(p.id)" class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0" style="background:var(--bg-input)">已添加</span>
                  </label>
                </div>
              </template>
            </div>
            <div v-if="hasMore" class="flex justify-center py-3 shrink-0">
              <button class="btn btn-ghost text-xs" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? '加载中...' : '加载更多歌单' }}</button>
            </div>
          </template>

          <!-- Album tab -->
          <template v-else>
            <div class="overflow-y-auto flex-1 px-4 py-2 space-y-3">
              <input v-model="albumSearch" type="text" placeholder="搜索专辑..." class="form-input w-full text-xs" />
              <template v-if="filteredAlbums.length > 0">
                <div class="space-y-0.5">
                  <label v-for="a in filteredAlbums" :key="a.id" class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border" :style="{ borderColor: isAdded(a.id) ? 'var(--border-primary)' : 'transparent', background: selectedIds.includes(a.id) ? 'var(--accent-glow)' : 'transparent' }" :class="isAdded(a.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'">
                    <input v-model="selectedIds" type="checkbox" :value="a.id" :disabled="isAdded(a.id)" class="shrink-0 rounded" />
                    <img v-if="a.picUrl" :src="`${a.picUrl}?param=60y60`" class="w-10 h-10 rounded-lg object-cover shrink-0" />
                    <div v-else class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:var(--bg-input)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--text-tertiary)" stroke-width="1.3"/></svg></div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm truncate" style="color:var(--text-primary)">{{ a.name }}</p>
                      <p class="text-2xs text-muted-deep mt-0.5">{{ a.size }} 首 · {{ a.artist?.name }} · {{ publishYear(a.publishTime) }}</p>
                    </div>
                    <span v-if="isAdded(a.id)" class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0" style="background:var(--bg-input)">已添加</span>
                  </label>
                </div>
              </template>
              <div v-else class="text-sm text-muted py-12 text-center">暂无专辑</div>
            </div>
          </template>

          <!-- Footer -->
          <div class="flex items-center justify-between px-5 py-3 shrink-0" style="border-top:1px solid var(--border-primary);background:var(--bg-app)">
            <span class="text-2xs text-muted">已选 {{ selectedIds.length }} 个</span>
            <div class="flex gap-2">
              <button class="btn btn-secondary" @click="$emit('update:visible', false)">取消</button>
              <button class="btn btn-primary" :disabled="saving || selectedIds.length === 0" @click="handleAddSelected">
                {{ saving ? '添加中...' : '确认添加' }}
              </button>
            </div>
          </div>
        </template>

        <!-- Error + manual input fallback -->
        <template v-else>
          <div class="px-5 py-4 flex-1">
            <p class="text-2xs text-warning mb-4">{{ error }}</p>
            <div>
              <label class="text-xs font-medium block mb-1.5" style="color:var(--text-primary)">手动输入{{ dialogType === 'playlist' ? '歌单' : '专辑' }} ID</label>
              <input v-model="manualId" type="number" placeholder="输入 ID" class="form-input w-full text-sm" @keyup.enter="handleAddSingle" />
            </div>
          </div>
          <div class="flex justify-end gap-2 px-5 py-3 shrink-0" style="border-top:1px solid var(--border-primary);background:var(--bg-app)">
            <button class="btn btn-secondary" @click="$emit('update:visible', false)">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="handleAddSingle">确认添加</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
interface NeteasePlaylist {
  id: number; name: string; trackCount: number; playCount: number
  coverImgUrl: string; creator: { nickname: string; userId: number }; subscribed: boolean
}

interface AlbumItem {
  id: number; name: string; size: number; picUrl: string
  artist: { name: string }; publishTime: number
}

const props = defineProps<{ visible: boolean; sourceIds: number[] }>()
const emit = defineEmits<{ 'update:visible': [v: boolean]; created: []; 'created-album': [] }>()

const api = useApi()

// Dialog type tab
const dialogType = ref<'playlist' | 'album'>('playlist')
const typeTabs = [
  { key: 'playlist' as const, label: '歌单' },
  { key: 'album' as const, label: '专辑' },
]

function switchType(key: 'playlist' | 'album') {
  dialogType.value = key
  selectedIds.value = []
  search.value = ''
  manualId.value = ''
  if (key === 'album') { fetchAlbums(); albumSearch.value = '' }
}

// Shared state
const loading = ref(false)
const loadingMore = ref(false)
const saving = ref(false)
const error = ref('')
const selectedIds = ref<number[]>([])
const manualId = ref('')

function isAdded(pid: number): boolean { return props.sourceIds.includes(pid) }

// ── Playlist tab ──
const list = ref<NeteasePlaylist[]>([])
const offset = ref(0)
const hasMore = ref(true)
const search = ref('')
const createdCollapsed = ref(false)
const subscribedCollapsed = ref(false)

const filtered = computed(() => {
  if (!search.value) return list.value
  const q = search.value.toLowerCase()
  return list.value.filter(p => p.name.toLowerCase().includes(q) || p.creator?.nickname?.toLowerCase().includes(q))
})
const created = computed(() => filtered.value.filter(p => !p.subscribed))
const subscribed = computed(() => filtered.value.filter(p => p.subscribed))

async function fetchList(reset = true) {
  if (reset) { loading.value = true; error.value = ''; offset.value = 0; hasMore.value = true }
  try {
    const items = await api.get<NeteasePlaylist[]>('/netease/playlists', { offset: String(offset.value) })
    if (reset) list.value = items
    else list.value.push(...items)
    hasMore.value = items.length >= 100
  } catch (err) {
    error.value = err instanceof Error ? err.message : '获取歌单列表失败，请检查 Cookie 配置'
    list.value = []
  } finally { loading.value = false }
}

async function loadMore() {
  loadingMore.value = true; offset.value += 100
  try {
    const items = await api.get<NeteasePlaylist[]>('/netease/playlists', { offset: String(offset.value) })
    list.value.push(...items); hasMore.value = items.length >= 100
  } catch { /* ignore */ } finally { loadingMore.value = false }
}

// ── Album tab ──
const albums = ref<AlbumItem[]>([])
const albumSearch = ref('')
const filteredAlbums = computed(() => {
  if (!albumSearch.value) return albums.value
  const q = albumSearch.value.toLowerCase()
  return albums.value.filter(a => a.name.toLowerCase().includes(q) || a.artist?.name?.toLowerCase().includes(q))
})

async function fetchAlbums() {
  loading.value = true; error.value = ''
  try {
    albums.value = await api.get<AlbumItem[]>('/netease/albums')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '获取专辑列表失败，请检查 Cookie 配置'
    albums.value = []
  } finally { loading.value = false }
}

function publishYear(ts: number): string {
  if (!ts) return ''
  return new Date(ts).getFullYear().toString()
}

// ── Add actions ──
async function handleAddSelected() {
  if (selectedIds.value.length === 0) return
  saving.value = true
  const isAlbum = dialogType.value === 'album'
  try {
    for (const pid of selectedIds.value) {
      const album = isAlbum ? albums.value.find(a => a.id === pid) : null
      const playlist = !isAlbum ? list.value.find(p => p.id === pid) : null
      await api.post('/playlist-sources', {
        neteasePlaylistId: pid,
        type: isAlbum ? 'album' : 'playlist',
        subscribed: playlist?.subscribed ?? false,
        ...(album ? { name: album.name, artist: album.artist?.name } : {}),
      })
    }
    emit('update:visible', false)
    if (isAlbum) emit('created-album')
    else emit('created')
  } catch { /* ignore */ } finally { saving.value = false }
}

async function handleAddSingle() {
  const id = parseInt(manualId.value, 10)
  if (isNaN(id) || id <= 0) return
  saving.value = true
  const isAlbum = dialogType.value === 'album'
  try {
    const playlist = !isAlbum ? list.value.find(p => p.id === id) : null
    await api.post('/playlist-sources', {
      neteasePlaylistId: id,
      type: isAlbum ? 'album' : 'playlist',
      subscribed: playlist?.subscribed ?? false,
    })
    emit('update:visible', false)
    if (isAlbum) emit('created-album')
    else emit('created')
  } catch { /* ignore */ } finally { saving.value = false }
}

watch(() => props.visible, (v) => {
  if (v) { manualId.value = ''; selectedIds.value = []; fetchList(true) }
})
</script>
