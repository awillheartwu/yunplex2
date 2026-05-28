<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-sm font-semibold">歌单源</h2>
        <p class="text-2xs text-muted mt-0.5">管理网易云歌单同步源，支持多歌单独立启停</p>
      </div>
      <div class="flex items-center gap-3">
        <button class="btn btn-secondary" @click="fetchSources">刷新</button>
        <button class="btn btn-primary" @click="openAdd">添加歌单源</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-16">
      <span class="text-muted text-sm">加载中...</span>
    </div>

    <!-- Empty -->
    <div v-else-if="sources.length === 0" class="section-card p-8">
      <EmptyState title="暂无歌单源" description="添加网易云歌单 ID 以开始同步管理">
        <template #extra>
          <button class="btn btn-primary mt-4" @click="openAdd">添加歌单源</button>
        </template>
      </EmptyState>
    </div>

    <!-- Source list -->
    <div v-else class="section-card overflow-hidden">
      <div class="divide-y divide-[var(--border-primary)]">
        <div
          v-for="(s, idx) in sources" :key="s.id"
          draggable="true"
          class="transition-colors"
          :class="dragOverIdx === idx ? 'bg-[var(--accent-glow)]' : ''"
          @dragstart="onDragStart(idx, $event)"
          @dragover.prevent="onDragOver(idx)"
          @dragleave="onDragLeave"
          @drop="onDrop(idx)"
          @dragend="onDragEnd"
        >
          <!-- Row -->
          <div class="px-5 py-3.5 flex items-center gap-4" :class="dragIdx === idx ? 'opacity-50' : ''">
            <!-- Drag handle -->
            <span class="shrink-0 cursor-grab active:cursor-grabbing" style="color:var(--text-tertiary)">
              <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
                <circle cx="4" cy="3" r="1.2" fill="currentColor"/><circle cx="8" cy="3" r="1.2" fill="currentColor"/>
                <circle cx="4" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/>
                <circle cx="4" cy="13" r="1.2" fill="currentColor"/><circle cx="8" cy="13" r="1.2" fill="currentColor"/>
              </svg>
            </span>

            <!-- Toggle -->
            <button
              class="relative w-9 h-5 rounded-full transition-all duration-200 shrink-0 cursor-pointer"
              :style="{ background: s.enabled ? 'var(--accent)' : 'var(--border-secondary)' }"
              :title="s.enabled ? '已启用，点击禁用' : '已禁用，点击启用'"
              :disabled="togglingId === s.id"
              @click="toggleEnabled(s)"
            >
              <span class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" :class="s.enabled ? 'right-0.5' : 'left-0.5'" />
            </button>

            <!-- Info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium truncate">{{ s.name || '(待获取)' }}</p>
                <span class="text-2xs px-1.5 py-0.5 rounded" style="background:var(--bg-input);color:var(--text-secondary)">{{ s.neteasePlaylistName }}</span>
                <span v-if="!s.enabled" class="text-2xs px-1.5 py-0.5 rounded text-muted-deep" style="background:var(--bg-input)">已禁用</span>
              </div>
              <div class="flex items-center gap-3 mt-0.5">
                <span class="text-2xs" style="color:var(--text-tertiary)">ID: {{ s.neteasePlaylistId }}</span>
                <span class="text-2xs" style="color:var(--text-tertiary)">Plex: {{ s.plexPlaylistName || s.neteasePlaylistName || '自动匹配' }}</span>
                <span class="text-2xs" style="color:var(--text-tertiary)">{{ s.trackCount }} 首</span>
              </div>
            </div>

            <!-- Last sync -->
            <button class="text-right shrink-0 min-w-[90px] cursor-pointer group flex items-center gap-1.5 justify-end" @click="toggleExpand(s.id)">
              <div>
                <div class="flex items-center gap-1.5 justify-end">
                  <span v-if="s.lastSyncedAt" class="w-1.5 h-1.5 rounded-full shrink-0" :class="s.lastStatus === 'success' ? 'bg-success' : s.lastStatus === 'partial' ? 'bg-warning' : 'bg-danger'" />
                  <p class="text-xs" :class="lastStatusColor(s.lastStatus)">{{ lastStatusLabel(s) }}</p>
                </div>
                <p v-if="s.lastSyncedAt" class="text-2xs mt-0.5" style="color:var(--text-tertiary)">{{ formatRelative(s.lastSyncedAt) }}</p>
              </div>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" class="transition-transform shrink-0 opacity-40" :class="expandedId === s.id ? 'rotate-90 opacity-100' : ''" style="color:var(--text-tertiary)">
                <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <!-- Icon actions -->
            <div class="flex items-center gap-0.5 shrink-0">
              <span class="tooltip-wrap">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer icon-btn"
                  :class="syncingSourceId === s.id ? 'icon-active' : ''"
                  :disabled="syncingSourceId === s.id || !s.enabled"
                  @click="syncSource(s)"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" class="transition-transform" :class="syncingSourceId === s.id ? 'animate-spin' : ''">
                    <path d="M13.5 8a5.5 5.5 0 00-9.9-3M2.5 8a5.5 5.5 0 009.9 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                    <path d="M2.5 2v3.5H6M13.5 14v-3.5H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <span class="tooltip-label">增量同步</span>
              </span>
              <span class="tooltip-wrap">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer icon-btn"
                  :class="forceFullId === s.id ? 'icon-active' : ''"
                  @click="syncSource(s, true)"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 8a5.5 5.5 0 00-9.9-3M2.5 8a5.5 5.5 0 009.9 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    <path d="M2.5 2v3.5H6M13.5 14v-3.5H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    <circle cx="8" cy="8" r="2" fill="currentColor" />
                  </svg>
                </button>
                <span class="tooltip-label">强制全量对比</span>
              </span>
              <span class="tooltip-wrap">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer icon-btn"
                  @click="openEdit(s)"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <span class="tooltip-label">编辑</span>
              </span>
              <span class="tooltip-wrap">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer icon-btn icon-delete"
                  @click="confirmDelete = s"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M6.5 7.5v4M9.5 7.5v4M3.5 4.5l1 8.5a1 1 0 001 1h5a1 1 0 001-1l1-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <span class="tooltip-label">删除</span>
              </span>
            </div>
          </div>

          <!-- Expanded songs -->
          <div v-if="expandedId === s.id" class="px-5 pb-4" style="border-top:1px solid var(--border-primary)">
            <div v-if="expandedLoading" class="text-2xs text-muted py-3">加载中...</div>
            <div v-else-if="expandedSongs.length === 0" class="text-2xs text-muted py-3">暂无歌曲记录</div>
            <div v-else class="grid grid-cols-2 gap-x-6 gap-y-1.5 pt-3">
              <div v-for="song in expandedSongs" :key="song.id" class="flex items-center gap-2 text-xs min-w-0">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="songStatusDot(song.status)" />
                <span class="truncate" style="color:var(--text-primary)">{{ song.songName }}</span>
                <span class="text-muted-deep shrink-0 truncate">{{ song.artist }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add dialog -->
    <Teleport to="body">
      <div v-if="showAdd" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)" @click.self="showAdd = false">
        <div class="w-[520px] max-h-[80vh] max-w-[92vw] flex flex-col rounded-xl border shadow-xl overflow-hidden" style="background:var(--bg-surface);border-color:var(--border-primary)">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 shrink-0" style="border-bottom:1px solid var(--border-primary)">
            <div class="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--accent)" stroke-width="1.3"/><path d="M8 5v6M5 8h6" stroke="var(--accent)" stroke-width="1.3" stroke-linecap="round"/></svg>
              <h3 class="text-sm font-semibold" style="color:var(--text-primary)">添加歌单源</h3>
            </div>
            <button class="btn btn-ghost text-xs" :disabled="playlistLoading" @click="fetchPlaylists">刷新歌单</button>
          </div>

          <template v-if="!playlistError">
            <div v-if="playlistLoading" class="text-sm text-muted py-12 text-center">加载歌单列表...</div>
            <div v-else class="overflow-y-auto flex-1 px-4 py-2 space-y-0.5">
              <label
                v-for="p in availablePlaylists"
                :key="p.id"
                class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors border"
                :style="{ borderColor: isPlaylistAdded(p.id) ? 'var(--border-primary)' : 'transparent', background: selectedPlaylistIds.includes(p.id) ? 'var(--accent-glow)' : 'transparent' }"
                :class="isPlaylistAdded(p.id) ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--bg-hover)]'"
              >
                <input
                  v-model="selectedPlaylistIds"
                  type="checkbox"
                  :value="p.id"
                  :disabled="isPlaylistAdded(p.id)"
                  class="shrink-0 rounded"
                />
                <img v-if="p.coverImgUrl" :src="`${p.coverImgUrl}?param=60y60`" class="w-10 h-10 rounded-lg object-cover shrink-0" />
                <div v-else class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:var(--bg-input)">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--text-tertiary)" stroke-width="1.3"/><path d="M10.5 5.5v3.8a1.8 1.8 0 01-1.8 1.8 1.8 1.8 0 01-1.8-1.8 1.8 1.8 0 013.6 0z" stroke="var(--text-tertiary)" stroke-width="1.3" stroke-linecap="round"/></svg>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm truncate" style="color:var(--text-primary)">{{ p.name }}</p>
                  <p class="text-2xs text-muted-deep mt-0.5">{{ p.trackCount }} 首{{ p.subscribed ? ' · 已收藏' : '' }}{{ p.creator?.nickname ? ' · ' + p.creator.nickname : '' }}</p>
                </div>
                <span v-if="isPlaylistAdded(p.id)" class="text-2xs px-2 py-0.5 rounded text-muted-deep shrink-0" style="background:var(--bg-input)">已添加</span>
              </label>
            </div>
            <div v-if="playlistHasMore" class="flex justify-center py-3 shrink-0">
              <button class="btn btn-ghost text-xs" :disabled="playlistLoadingMore" @click="loadMorePlaylists">
                {{ playlistLoadingMore ? '加载中...' : '加载更多歌单' }}
              </button>
            </div>
            <!-- Footer -->
            <div class="flex items-center justify-between px-5 py-3 shrink-0" style="border-top:1px solid var(--border-primary);background:var(--bg-app)">
              <span class="text-2xs text-muted">已选 {{ selectedPlaylistIds.length }} 个歌单</span>
              <div class="flex gap-2">
                <button class="btn btn-secondary" @click="showAdd = false">取消</button>
                <button class="btn btn-primary" :disabled="addLoading || selectedPlaylistIds.length === 0" @click="handleAddSelected">
                  {{ addLoading ? '添加中...' : '确认添加' }}
                </button>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="px-5 py-4 flex-1">
              <p class="text-2xs text-warning mb-4">{{ playlistError }}</p>
              <div>
                <label class="text-xs font-medium block mb-1.5" style="color:var(--text-primary)">手动输入歌单 ID</label>
                <input v-model="addForm.playlistId" type="number" placeholder="输入歌单 ID（数字）" class="form-input w-full text-sm" @keyup.enter="handleAddSingle" />
              </div>
            </div>
            <div class="flex justify-end gap-2 px-5 py-3 shrink-0" style="border-top:1px solid var(--border-primary);background:var(--bg-app)">
              <button class="btn btn-secondary" @click="showAdd = false">取消</button>
              <button class="btn btn-primary" :disabled="addLoading" @click="handleAddSingle">
                {{ addLoading ? '添加中...' : '确认添加' }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>

    <!-- Edit dialog -->
    <Teleport to="body">
      <div v-if="editTarget" class="fixed inset-0 z-50 flex items-center justify-center" style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)" @click.self="editTarget = null">
        <div class="w-[460px] max-w-[92vw] rounded-xl border shadow-xl overflow-hidden" style="background:var(--bg-surface);border-color:var(--border-primary)">
          <!-- Header -->
          <div class="flex items-center gap-2 px-5 py-4" style="border-bottom:1px solid var(--border-primary)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="var(--accent)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <h3 class="text-sm font-semibold" style="color:var(--text-primary)">编辑歌单源</h3>
          </div>

          <div class="px-5 py-4 space-y-4">
            <!-- Netease playlist name (read-only) -->
            <div>
              <label class="text-2xs font-medium block mb-1.5" style="color:var(--text-tertiary)">网易云歌单</label>
              <div class="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style="background:var(--bg-input);color:var(--text-secondary)">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--text-tertiary)" stroke-width="1.3"/><path d="M10.5 5.5v3.8a1.8 1.8 0 01-1.8 1.8 1.8 1.8 0 01-1.8-1.8 1.8 1.8 0 013.6 0z" stroke="var(--text-tertiary)" stroke-width="1.3" stroke-linecap="round"/></svg>
                {{ editTarget.neteasePlaylistName }}
              </div>
            </div>

            <!-- Task name -->
            <div>
              <label class="text-2xs font-medium block mb-1.5" style="color:var(--text-tertiary)">任务名称</label>
              <input v-model="editForm.name" type="text" class="form-input w-full text-sm" />
            </div>

            <!-- Plex playlist -->
            <div>
              <label class="text-2xs font-medium block mb-1.5" style="color:var(--text-tertiary)">Plex 目标歌单</label>
              <select v-if="plexPlaylists.length > 0" v-model="editForm.plexPlaylistName" class="form-input w-full text-sm">
                <option value="">自动匹配（网易云同名）</option>
                <option v-for="pp in plexPlaylists" :key="pp.ratingKey" :value="pp.title">{{ pp.title }}</option>
              </select>
              <input v-else v-model="editForm.plexPlaylistName" type="text" placeholder="留空则自动匹配网易云同名" class="form-input w-full text-sm" />
              <p v-if="plexError" class="text-2xs text-warning mt-1">{{ plexError }}</p>
            </div>

            <!-- Sync limit -->
            <div>
              <label class="text-2xs font-medium block mb-1.5" style="color:var(--text-tertiary)">同步数量上限</label>
              <input v-model.number="editForm.syncLimit" type="number" placeholder="留空则使用全局设置" class="form-input w-full text-sm" />
            </div>

            <!-- Divider before toggles -->
            <div style="height:1px;background:var(--border-primary)" />

            <!-- Toggles -->
            <ToggleField v-model="editForm.enabled" label="启用" hint="关闭后该歌单将不会参与同步" />
            <ToggleField v-model="editForm.autoCreatePlexPlaylist" label="自动创建 Plex 歌单" hint="Plex 中不存在同名歌单时自动创建" />
            <ToggleField v-model="editForm.forceFullCompare" label="始终全量对比" hint="覆盖全局设置，每次都进行完整对比" />

            <!-- Per-source skip limits (hidden when always full) -->
            <template v-if="!editForm.forceFullCompare">
              <div style="height:1px;background:var(--border-primary)" />
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="text-2xs font-medium block mb-1" style="color:var(--text-tertiary)">连续跳过上限</label>
                  <input v-model.number="editForm.fullCompareAfterSkips" type="number" placeholder="全局" class="form-input w-full text-sm" min="0" />
                </div>
                <div>
                  <label class="text-2xs font-medium block mb-1" style="color:var(--text-tertiary)">距上次全量(天)</label>
                  <input v-model.number="editForm.fullCompareAfterDays" type="number" placeholder="全局" class="form-input w-full text-sm" min="0" />
                </div>
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="flex justify-end gap-2 px-5 py-3" style="border-top:1px solid var(--border-primary);background:var(--bg-app)">
            <button class="btn btn-secondary" @click="editTarget = null">取消</button>
            <button class="btn btn-primary" :disabled="editLoading" @click="handleEdit">
              {{ editLoading ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Delete confirm -->
    <ConfirmDialog
      :visible="!!confirmDelete"
      title="删除歌单源"
      :message="`确定要删除歌单源「${confirmDelete?.name}」吗？此操作不可撤销。`"
      confirm-label="删除"
      variant="danger"
      @confirm="handleDelete"
      @cancel="confirmDelete = null"
    />
  </div>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'

interface NeteasePlaylist {
  id: number; name: string; trackCount: number; playCount: number
  coverImgUrl: string; creator: { nickname: string; userId: number }; subscribed: boolean
}
interface PlexPlaylistItem { title: string; ratingKey: string }

const api = useApi()
const { syncingSourceId, syncSource: triggerSourceSync } = useSourceSync()
const sources = ref<PlaylistSource[]>([])
const loading = ref(false)
const togglingId = ref<string | null>(null)
const forceFullId = ref<string | null>(null)

// Add
const showAdd = ref(false)
const addLoading = ref(false)
const availablePlaylists = ref<NeteasePlaylist[]>([])
const playlistLoading = ref(false)
const playlistLoadingMore = ref(false)
const playlistOffset = ref(0)
const playlistHasMore = ref(true)
const playlistError = ref('')
const selectedPlaylistIds = ref<number[]>([])
const addForm = reactive({ playlistId: '' })

// Edit
const editTarget = ref<PlaylistSource | null>(null)
const editLoading = ref(false)
const editForm = reactive({ name: '', plexPlaylistName: '', syncLimit: null as number | null, enabled: true, autoCreatePlexPlaylist: true, forceFullCompare: false, fullCompareAfterSkips: null as number | null, fullCompareAfterDays: null as number | null })
const plexPlaylists = ref<PlexPlaylistItem[]>([])
const plexError = ref('')

const confirmDelete = ref<PlaylistSource | null>(null)

// Drag & drop
const dragIdx = ref<number | null>(null)
const dragOverIdx = ref<number | null>(null)

function onDragStart(idx: number, e: DragEvent) {
  dragIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}
function onDragOver(idx: number) {
  if (dragIdx.value === null || dragIdx.value === idx) return
  dragOverIdx.value = idx
}
function onDragLeave() {
  dragOverIdx.value = null
}
async function onDrop(idx: number) {
  if (dragIdx.value === null || dragIdx.value === idx) return
  const items = [...sources.value]
  const [moved] = items.splice(dragIdx.value, 1)
  if (!moved) return
  items.splice(idx, 0, moved)
  sources.value = items
  dragIdx.value = null
  dragOverIdx.value = null
  // Persist
  try {
    await api.put('/playlist-sources/reorder', { orderedIds: items.map(s => s.id) })
  } catch { /* ignore */ }
}
function onDragEnd() {
  dragIdx.value = null
  dragOverIdx.value = null
}

async function fetchSources() {
  loading.value = true
  try { sources.value = await api.get<PlaylistSource[]>('/playlist-sources') } catch { /* ignore */ }
  finally { loading.value = false }
}

// Toggle enabled from list row
async function toggleEnabled(s: PlaylistSource) {
  togglingId.value = s.id
  try {
    await api.put(`/playlist-sources/${s.id}`, { enabled: !s.enabled })
    s.enabled = !s.enabled
  } catch { /* ignore */ }
  finally { togglingId.value = null }
}

// Expand songs
const expandedId = ref<string | null>(null)
const expandedSongs = ref<Array<{ id: string; songName: string; artist: string; status: string }>>([])
const expandedLoading = ref(false)

async function toggleExpand(sourceId: string) {
  if (expandedId.value === sourceId) { expandedId.value = null; return }
  expandedId.value = sourceId
  expandedLoading.value = true
  try { expandedSongs.value = await api.get(`/playlist-sources/${sourceId}/songs`) } catch { expandedSongs.value = [] }
  finally { expandedLoading.value = false }
}

function songStatusDot(status: string): string {
  switch (status) {
    case 'success': return 'bg-success'
    case 'failed_download': case 'failed_plex_match': case 'failed_plex_insert': return 'bg-danger'
    case 'skipped_existing': return 'bg-[var(--border-secondary)]'
    default: return 'bg-muted-deep'
  }
}

function isPlaylistAdded(pid: number): boolean { return sources.value.some(s => s.neteasePlaylistId === pid) }
async function fetchPlaylists(reset = true) {
  if (reset) {
    playlistLoading.value = true; playlistError.value = ''
    playlistOffset.value = 0; playlistHasMore.value = true
  }
  try {
    const items = await api.get<NeteasePlaylist[]>('/netease/playlists', { offset: String(playlistOffset.value) })
    if (reset) availablePlaylists.value = items
    else availablePlaylists.value.push(...items)
    playlistHasMore.value = items.length >= 100
  }
  catch (err) { playlistError.value = err instanceof Error ? err.message : '获取歌单列表失败，请检查 Cookie 配置'; availablePlaylists.value = [] }
  finally { playlistLoading.value = false }
}

async function loadMorePlaylists() {
  playlistLoadingMore.value = true
  playlistOffset.value += 100
  try {
    const items = await api.get<NeteasePlaylist[]>('/netease/playlists', { offset: String(playlistOffset.value) })
    availablePlaylists.value.push(...items)
    playlistHasMore.value = items.length >= 100
  } catch { /* ignore */ }
  finally { playlistLoadingMore.value = false }
}

function openAdd() { addForm.playlistId = ''; selectedPlaylistIds.value = []; showAdd.value = true; fetchPlaylists() }

async function handleAddSelected() {
  if (selectedPlaylistIds.value.length === 0) return
  addLoading.value = true
  try { for (const pid of selectedPlaylistIds.value) { await api.post('/playlist-sources', { neteasePlaylistId: pid }) }; showAdd.value = false; await fetchSources() }
  catch { /* ignore */ } finally { addLoading.value = false }
}

async function handleAddSingle() {
  const id = parseInt(addForm.playlistId, 10)
  if (isNaN(id) || id <= 0) return
  addLoading.value = true
  try { await api.post('/playlist-sources', { neteasePlaylistId: id }); showAdd.value = false; await fetchSources() }
  catch { /* ignore */ } finally { addLoading.value = false }
}

async function fetchPlexPlaylists() {
  plexError.value = ''
  try { plexPlaylists.value = await api.get<PlexPlaylistItem[]>('/plex/playlists') }
  catch (err) { plexError.value = err instanceof Error ? err.message : '获取 Plex 歌单失败'; plexPlaylists.value = [] }
}

function openEdit(s: PlaylistSource) {
  editTarget.value = s
  editForm.name = s.name
  editForm.plexPlaylistName = s.plexPlaylistName || s.neteasePlaylistName
  editForm.syncLimit = s.syncLimit
  editForm.enabled = s.enabled
  editForm.autoCreatePlexPlaylist = s.autoCreatePlexPlaylist ?? true
  editForm.forceFullCompare = s.forceFullCompare ?? false
  editForm.fullCompareAfterSkips = s.fullCompareAfterSkips
  editForm.fullCompareAfterDays = s.fullCompareAfterDays
  plexPlaylists.value = []; plexError.value = ''
  fetchPlexPlaylists()
}

async function handleEdit() {
  if (!editTarget.value) return
  editLoading.value = true
  try {
    await api.put(`/playlist-sources/${editTarget.value.id}`, {
      name: editForm.name, plexPlaylistName: editForm.plexPlaylistName || '',
      syncLimit: editForm.syncLimit, enabled: editForm.enabled, autoCreatePlexPlaylist: editForm.autoCreatePlexPlaylist, forceFullCompare: editForm.forceFullCompare,
      fullCompareAfterSkips: editForm.fullCompareAfterSkips, fullCompareAfterDays: editForm.fullCompareAfterDays,
    })
    editTarget.value = null; await fetchSources()
  } catch { /* ignore */ } finally { editLoading.value = false }
}

async function handleDelete() {
  if (!confirmDelete.value) return
  const id = confirmDelete.value.id; confirmDelete.value = null
  try { await api.del(`/playlist-sources/${id}`); await fetchSources() } catch { /* ignore */ }
}

async function syncSource(s: PlaylistSource, forceFull = false) {
  try {
    if (forceFull) {
      await api.post(`/playlist-sources/${s.id}/sync`, { forceFull: true })
    } else {
      await triggerSourceSync(s.id)
    }
  } catch { /* ignore */ }
}

function lastStatusLabel(s: PlaylistSource): string {
  if (!s.lastSyncedAt) return '未同步'
  switch (s.lastStatus) {
    case 'success': return '同步成功'
    case 'partial': return '部分失败'
    case 'failed': return '同步失败'
    default: return '空闲'
  }
}
function lastStatusColor(status: string): string {
  switch (status) {
    case 'success': return 'text-success'
    case 'partial': return 'text-warning'
    case 'failed': return 'text-danger'
    default: return 'text-muted-deep'
  }
}
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

onMounted(fetchSources)
</script>

<style scoped>
.icon-btn {
  color: var(--text-tertiary);
}
.icon-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.icon-btn.icon-active {
  color: var(--accent);
}
.icon-btn.icon-active:hover {
  color: var(--accent);
  background: var(--bg-hover);
}
.icon-delete:hover {
  color: var(--danger, #e74c3c);
}

.tooltip-wrap {
  position: relative;
}
.tooltip-label {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 11px;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--bg-tooltip, #333);
  color: #fff;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}
.tooltip-wrap:hover .tooltip-label {
  opacity: 1;
}
</style>
