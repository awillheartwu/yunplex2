<template>
  <Teleport to="body">
    <div v-if="source" class="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center" style="background:var(--bg-overlay);backdrop-filter:blur(8px)" @click.self="$emit('close')">
      <div class="w-[460px] max-w-[92vw] rounded-xl border shadow-xl overflow-hidden" style="background:var(--bg-surface);border-color:var(--border-primary)">
        <!-- Header -->
        <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--border-primary)">
          <AppIcon name="edit" :size="16" class="text-accent" />
          <h3 class="text-sm font-semibold" style="color:var(--text-primary)">{{ source.type === 'album' ? '编辑专辑源' : '编辑歌单源' }}</h3>
        </div>

        <div class="px-5 py-4 space-y-4">
          <!-- Netease source name (read-only) -->
          <div>
            <label class="text-2xs font-medium block mb-1.5" style="color:var(--text-tertiary)">{{ source.type === 'album' ? '网易云专辑' : '网易云歌单' }}</label>
            <div class="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style="background:var(--bg-input);color:var(--text-secondary)">
              <AppIcon :name="source.type === 'album' ? 'album' : 'music'" :size="12" class="text-muted-deep" />
              {{ source.neteasePlaylistName }}
            </div>
          </div>

          <!-- Task name -->
          <div>
            <label class="text-2xs font-medium block mb-1.5" style="color:var(--text-tertiary)">任务名称</label>
            <input v-model="form.name" type="text" class="form-input w-full text-sm" />
          </div>

          <!-- Album-only: skip Plex playlist -->
          <template v-if="source.type === 'album'">
            <ToggleField v-model="form.skipPlexPlaylist" label="仅下载不入歌单" hint="只下载到本地并导入 Plex 库，不创建 Plex 歌单也不重排" />
          </template>

          <!-- Playlist-only settings -->
          <template v-if="source.type === 'playlist'">
          <!-- Plex playlist -->
          <div>
            <label class="text-2xs font-medium block mb-1.5" style="color:var(--text-tertiary)">Plex 目标歌单</label>
            <select v-if="plexPlaylists.length > 0" v-model="form.plexPlaylistName" class="form-input w-full text-sm">
              <option value="">自动匹配（网易云同名）</option>
              <option v-for="pp in plexPlaylists" :key="pp.ratingKey" :value="pp.title">{{ pp.title }}</option>
            </select>
            <input v-else v-model="form.plexPlaylistName" type="text" placeholder="留空则自动匹配网易云同名" class="form-input w-full text-sm" />
            <p v-if="plexError" class="text-2xs text-warning mt-1">{{ plexError }}</p>
          </div>

          <!-- Sync limit -->
          <div>
            <label class="text-2xs font-medium block mb-1.5" style="color:var(--text-tertiary)">同步数量上限</label>
            <input v-model.number="form.syncLimit" type="number" placeholder="留空则使用全局设置" class="form-input w-full text-sm" />
          </div>

          <!-- Toggles -->
          <div style="height:1px;background:var(--border-primary)" />
          <ToggleField v-model="form.enabled" label="启用" hint="关闭后该歌单将不会参与同步" />
          <ToggleField v-model="form.autoCreatePlexPlaylist" label="自动创建 Plex 歌单" hint="Plex 中不存在同名歌单时自动创建" />
          <ToggleField v-model="form.forceFullCompare" label="始终全量对比" hint="覆盖全局设置，每次都进行完整对比" />
	      <ToggleField v-model="form.skipRemoveExtraTracks" label="不删除多余歌曲" hint="覆盖全局设置，保留 Plex 中网易云已移除的歌曲" />
          <!-- Per-source skip limits (hidden when always full) -->
          <template v-if="!form.forceFullCompare">
            <div style="height:1px;background:var(--border-primary)" />
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-2xs font-medium block mb-1" style="color:var(--text-tertiary)">连续跳过上限</label>
                <input v-model.number="form.fullCompareAfterSkips" type="number" placeholder="全局" class="form-input w-full text-sm" min="0" />
              </div>
              <div>
                <label class="text-2xs font-medium block mb-1" style="color:var(--text-tertiary)">距上次全量(天)</label>
                <input v-model.number="form.fullCompareAfterDays" type="number" placeholder="全局" class="form-input w-full text-sm" min="0" />
              </div>
            </div>
          </template>
          </template>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 px-5 py-3" style="border-top:1px solid var(--border-primary);background:var(--bg-app)">
          <button class="btn btn-secondary" @click="$emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="loading" @click="handleSave">
            {{ loading ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'

interface PlexPlaylistItem { title: string; ratingKey: string }

const props = defineProps<{ source: PlaylistSource | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const api = useApi()
const loading = ref(false)
const plexPlaylists = ref<PlexPlaylistItem[]>([])
const plexError = ref('')

const form = reactive({
  name: '',
  plexPlaylistName: '',
  syncLimit: null as number | null,
  enabled: true,
  autoCreatePlexPlaylist: true,
  forceFullCompare: false,
  skipRemoveExtraTracks: false,
  fullCompareAfterSkips: null as number | null,
  fullCompareAfterDays: null as number | null,
  skipPlexPlaylist: false,
  subscribed: false,
})

watch(() => props.source, (s) => {
  if (!s) return
  form.name = s.name
  form.plexPlaylistName = s.plexPlaylistName || s.neteasePlaylistName
  form.syncLimit = s.syncLimit
  form.enabled = s.enabled
  form.autoCreatePlexPlaylist = s.autoCreatePlexPlaylist ?? true
  form.forceFullCompare = s.forceFullCompare ?? false
  form.skipRemoveExtraTracks = s.skipRemoveExtraTracks ?? false
  form.fullCompareAfterSkips = s.fullCompareAfterSkips
  form.fullCompareAfterDays = s.fullCompareAfterDays
  form.skipPlexPlaylist = s.skipPlexPlaylist ?? false
  form.subscribed = s.subscribed ?? false

  // Reset then refetch
  plexPlaylists.value = []
  plexError.value = ''
  fetchPlexPlaylists()
})

async function fetchPlexPlaylists() {
  plexError.value = ''
  try { plexPlaylists.value = await api.get<PlexPlaylistItem[]>('/plex/playlists') }
  catch (err) { plexError.value = err instanceof Error ? err.message : '获取 Plex 歌单失败'; plexPlaylists.value = [] }
}

async function handleSave() {
  if (!props.source) return
  loading.value = true
  try {
    await api.put(`/playlist-sources/${props.source.id}`, {
      name: form.name,
      plexPlaylistName: form.plexPlaylistName || '',
      syncLimit: form.syncLimit,
      enabled: form.enabled,
      autoCreatePlexPlaylist: form.autoCreatePlexPlaylist,
      forceFullCompare: form.forceFullCompare,
      skipRemoveExtraTracks: form.skipRemoveExtraTracks,
      fullCompareAfterSkips: form.fullCompareAfterSkips,
      fullCompareAfterDays: form.fullCompareAfterDays,
      skipPlexPlaylist: form.skipPlexPlaylist,
      subscribed: form.subscribed,
    })
    emit('saved')
    emit('close')
  } catch { /* ignore */ } finally { loading.value = false }
}
</script>
