<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)" @click.self="$emit('update:visible', false)">
      <div class="w-[520px] max-h-[80vh] max-w-[92vw] flex flex-col rounded-xl border shadow-xl overflow-hidden" style="background:var(--bg-surface);border-color:var(--border-primary)">
        <div class="flex items-center justify-between px-5 py-4 shrink-0" style="border-bottom:1px solid var(--border-primary)">
          <div class="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--accent)" stroke-width="1.3"/><circle cx="8" cy="8" r="2.5" fill="var(--accent)" opacity="0.3"/></svg>
            <h3 class="text-sm font-semibold" style="color:var(--text-primary)">添加专辑</h3>
          </div>
          <button class="btn btn-ghost text-xs" :disabled="loading" @click="fetchList">刷新</button>
        </div>
        <template v-if="!error">
          <div v-if="loading" class="text-sm text-muted py-12 text-center">加载专辑列表...</div>
          <div v-else-if="list.length === 0" class="text-sm text-muted py-12 text-center">暂无可添加的专辑</div>
          <div v-else class="overflow-y-auto flex-1 px-4 py-2 space-y-3">
            <input v-model="search" type="text" placeholder="搜索专辑或艺人..." class="form-input w-full text-xs" />
            <div class="space-y-0.5">
            <label
              v-for="a in filteredList" :key="a.id"
              class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border"
              :style="{ borderColor: isAdded(a.id) ? 'var(--border-primary)' : 'transparent', background: selectedIds.includes(a.id) ? 'var(--accent-glow)' : 'transparent' }"
              :class="isAdded(a.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'"
            >
              <input v-model="selectedIds" type="checkbox" :value="a.id" :disabled="isAdded(a.id)" class="shrink-0 rounded" />
              <img v-if="a.picUrl" :src="`${a.picUrl}?param=60y60`" class="w-10 h-10 rounded-lg object-cover shrink-0" />
              <div v-else class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:var(--bg-input)">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--text-tertiary)" stroke-width="1.3"/><circle cx="8" cy="8" r="2.5" stroke="var(--text-tertiary)" stroke-width="1.3"/></svg>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm truncate" style="color:var(--text-primary)">{{ a.name }}</p>
                <p class="text-2xs text-muted-deep mt-0.5">{{ a.artist?.name || '' }} · {{ a.size }} 首</p>
              </div>
              <span v-if="isAdded(a.id)" class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0" style="background:var(--bg-input)">已添加</span>
            </label>
            </div>
          </div>
          <div class="flex items-center justify-between px-5 py-3 shrink-0" style="border-top:1px solid var(--border-primary);background:var(--bg-app)">
            <span class="text-2xs text-muted">已选 {{ selectedIds.length }} 张专辑</span>
            <div class="flex gap-2">
              <button class="btn btn-secondary" @click="$emit('update:visible', false)">取消</button>
              <button class="btn btn-primary" :disabled="saving || selectedIds.length === 0" @click="handleAdd">
                {{ saving ? '添加中...' : '确认添加' }}
              </button>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="px-5 py-4 flex-1"><p class="text-2xs text-warning mb-4">{{ error }}</p></div>
          <div class="flex justify-end gap-2 px-5 py-3 shrink-0" style="border-top:1px solid var(--border-primary);background:var(--bg-app)">
            <button class="btn btn-secondary" @click="$emit('update:visible', false)">取消</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
interface NeteaseAlbum {
  id: number; name: string; size: number; picUrl: string
  artist: { name: string }; publishTime: number; subTime: number
}

const props = defineProps<{ visible: boolean; sourceIds: number[] }>()
const emit = defineEmits<{ 'update:visible': [v: boolean]; created: [] }>()

const api = useApi()

const list = ref<NeteaseAlbum[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const selectedIds = ref<number[]>([])

function isAdded(aid: number): boolean { return props.sourceIds.includes(aid) }
const search = ref('')
const filteredList = computed(() => {
  if (!search.value) return list.value
  const q = search.value.toLowerCase()
  return list.value.filter(a => a.name.toLowerCase().includes(q) || a.artist?.name?.toLowerCase().includes(q))
})

async function fetchList() {
  loading.value = true; error.value = ''
  try { list.value = await api.get<NeteaseAlbum[]>('/netease/albums') }
  catch (err) { error.value = err instanceof Error ? err.message : '获取专辑列表失败'; list.value = [] }
  finally { loading.value = false }
}

async function handleAdd() {
  if (selectedIds.value.length === 0) return
  saving.value = true
  try {
    for (const aid of selectedIds.value) {
      const a = list.value.find(x => x.id === aid)
      await api.post('/playlist-sources', {
        neteasePlaylistId: aid, type: 'album',
        trackCount: a?.size || 0, name: a?.name || '', artist: a?.artist?.name || '',
      })
    }
    emit('update:visible', false)
    emit('created')
  } catch { /* ignore */ } finally { saving.value = false }
}

watch(() => props.visible, (v) => { if (v) { selectedIds.value = []; fetchList() } })
</script>
