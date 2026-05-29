<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)" @click.self="$emit('update:visible', false)">
      <div class="w-[520px] max-h-[80vh] max-w-[92vw] flex flex-col rounded-xl border shadow-xl overflow-hidden" style="background:var(--bg-surface);border-color:var(--border-primary)">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 shrink-0" style="border-bottom:1px solid var(--border-primary)">
          <div class="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--accent)" stroke-width="1.3"/><path d="M8 5v6M5 8h6" stroke="var(--accent)" stroke-width="1.3" stroke-linecap="round"/></svg>
            <h3 class="text-sm font-semibold" style="color:var(--text-primary)">添加歌单源</h3>
          </div>
          <button class="btn btn-ghost text-xs" :disabled="loading" @click="() => fetchList(true)">刷新歌单</button>
        </div>

        <template v-if="!error">
          <div v-if="loading" class="text-sm text-muted py-12 text-center">加载歌单列表...</div>
          <div v-else class="overflow-y-auto flex-1 px-4 py-2 space-y-3">
            <!-- Created playlists -->
            <template v-if="created.length > 0">
              <p class="text-2xs text-muted-deep px-1">我创建的</p>
              <div class="space-y-0.5">
                <label
                  v-for="p in created" :key="p.id"
                  class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border"
                  :style="{ borderColor: isAdded(p.id) ? 'var(--border-primary)' : 'transparent', background: selectedIds.includes(p.id) ? 'var(--accent-glow)' : 'transparent' }"
                  :class="isAdded(p.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'"
                >
                  <input v-model="selectedIds" type="checkbox" :value="p.id" :disabled="isAdded(p.id)" class="shrink-0 rounded" />
                  <img v-if="p.coverImgUrl" :src="`${p.coverImgUrl}?param=60y60`" class="w-10 h-10 rounded-lg object-cover shrink-0" />
                  <div v-else class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:var(--bg-input)">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--text-tertiary)" stroke-width="1.3"/><path d="M10.5 5.5v3.8a1.8 1.8 0 01-1.8 1.8 1.8 1.8 0 01-1.8-1.8 1.8 1.8 0 013.6 0z" stroke="var(--text-tertiary)" stroke-width="1.3" stroke-linecap="round"/></svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm truncate" style="color:var(--text-primary)">{{ p.name }}</p>
                    <p class="text-2xs text-muted-deep mt-0.5">{{ p.trackCount }} 首{{ p.creator?.nickname ? ' · ' + p.creator.nickname : '' }}</p>
                  </div>
                  <span v-if="isAdded(p.id)" class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0" style="background:var(--bg-input)">已添加</span>
                </label>
              </div>
            </template>

            <!-- Subscribed playlists -->
            <template v-if="subscribed.length > 0">
              <p class="text-2xs text-muted-deep px-1">收藏的歌单</p>
              <div class="space-y-0.5">
                <label
                  v-for="p in subscribed" :key="p.id"
                  class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border"
                  :style="{ borderColor: isAdded(p.id) ? 'var(--border-primary)' : 'transparent', background: selectedIds.includes(p.id) ? 'var(--accent-glow)' : 'transparent' }"
                  :class="isAdded(p.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'"
                >
                  <input v-model="selectedIds" type="checkbox" :value="p.id" :disabled="isAdded(p.id)" class="shrink-0 rounded" />
                  <img v-if="p.coverImgUrl" :src="`${p.coverImgUrl}?param=60y60`" class="w-10 h-10 rounded-lg object-cover shrink-0" />
                  <div v-else class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:var(--bg-input)">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--text-tertiary)" stroke-width="1.3"/><path d="M10.5 5.5v3.8a1.8 1.8 0 01-1.8 1.8 1.8 1.8 0 01-1.8-1.8 1.8 1.8 0 013.6 0z" stroke="var(--text-tertiary)" stroke-width="1.3" stroke-linecap="round"/></svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm truncate" style="color:var(--text-primary)">{{ p.name }}</p>
                    <p class="text-2xs text-muted-deep mt-0.5">{{ p.trackCount }} 首{{ p.creator?.nickname ? ' · ' + p.creator.nickname : '' }}</p>
                  </div>
                  <span v-if="isAdded(p.id)" class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0" style="background:var(--bg-input)">已添加</span>
                </label>
              </div>
            </template>
          </div>
          <div v-if="hasMore" class="flex justify-center py-3 shrink-0">
            <button class="btn btn-ghost text-xs" :disabled="loadingMore" @click="loadMore">
              {{ loadingMore ? '加载中...' : '加载更多歌单' }}
            </button>
          </div>
          <!-- Footer -->
          <div class="flex items-center justify-between px-5 py-3 shrink-0" style="border-top:1px solid var(--border-primary);background:var(--bg-app)">
            <span class="text-2xs text-muted">已选 {{ selectedIds.length }} 个歌单</span>
            <div class="flex gap-2">
              <button class="btn btn-secondary" @click="$emit('update:visible', false)">取消</button>
              <button class="btn btn-primary" :disabled="saving || selectedIds.length === 0" @click="handleAddSelected">
                {{ saving ? '添加中...' : '确认添加' }}
              </button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="px-5 py-4 flex-1">
            <p class="text-2xs text-warning mb-4">{{ error }}</p>
            <div>
              <label class="text-xs font-medium block mb-1.5" style="color:var(--text-primary)">手动输入歌单 ID</label>
              <input v-model="manualId" type="number" placeholder="输入歌单 ID" class="form-input w-full text-sm" @keyup.enter="handleAddSingle" />
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

const props = defineProps<{ visible: boolean; sourceIds: number[] }>()
const emit = defineEmits<{ 'update:visible': [v: boolean]; created: [] }>()

const api = useApi()

const list = ref<NeteasePlaylist[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const saving = ref(false)
const offset = ref(0)
const hasMore = ref(true)
const error = ref('')
const selectedIds = ref<number[]>([])
const manualId = ref('')

function isAdded(pid: number): boolean { return props.sourceIds.includes(pid) }
const created = computed(() => list.value.filter(p => !p.subscribed))
const subscribed = computed(() => list.value.filter(p => p.subscribed))

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
  loadingMore.value = true
  offset.value += 100
  try {
    const items = await api.get<NeteasePlaylist[]>('/netease/playlists', { offset: String(offset.value) })
    list.value.push(...items)
    hasMore.value = items.length >= 100
  } catch { /* ignore */ } finally { loadingMore.value = false }
}

async function handleAddSelected() {
  if (selectedIds.value.length === 0) return
  saving.value = true
  try {
    for (const pid of selectedIds.value) await api.post('/playlist-sources', { neteasePlaylistId: pid })
    emit('update:visible', false)
    emit('created')
  } catch { /* ignore */ } finally { saving.value = false }
}

async function handleAddSingle() {
  const id = parseInt(manualId.value, 10)
  if (isNaN(id) || id <= 0) return
  saving.value = true
  try {
    await api.post('/playlist-sources', { neteasePlaylistId: id })
    emit('update:visible', false)
    emit('created')
  } catch { /* ignore */ } finally { saving.value = false }
}

watch(() => props.visible, (v) => {
  if (v) { manualId.value = ''; selectedIds.value = []; fetchList(true) }
})
</script>
