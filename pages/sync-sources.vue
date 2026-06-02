<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-sm font-semibold">同步源</h2>
        <p class="text-2xs text-muted mt-0.5">长期管理网易云歌单同步源，支持自动同步、增量比较与排序修复</p>
      </div>
      <div class="flex items-center gap-3">
        <button class="btn btn-secondary text-xs" @click="fetchSources">刷新</button>
        <button class="btn btn-primary" @click="openAddPlaylist">添加同步源</button>
      </div>
    </div>

    <!-- Summary bar -->
    <div class="grid grid-cols-5 gap-3">
      <div class="section-card p-3 text-center">
        <p class="text-2xs text-muted-deep mb-0.5">已启用源</p>
        <p class="text-lg font-semibold" style="color:var(--text-primary)">{{ enabledCount }}</p>
      </div>
      <div class="section-card p-3 text-center">
        <p class="text-2xs text-muted-deep mb-0.5">自动同步</p>
        <p class="text-sm font-semibold" :class="autoSyncEnabled ? 'text-success' : 'text-muted-deep'">{{ autoSyncEnabled ? '已开启' : '已关闭' }}</p>
      </div>
      <div class="section-card p-3 text-center">
        <p class="text-2xs text-muted-deep mb-0.5">上次同步</p>
        <p class="text-sm font-semibold" :class="lastSyncTime ? 'text-success' : 'text-muted-deep'">{{ lastSyncTime || '尚未同步' }}</p>
      </div>
      <div class="section-card p-3 text-center">
        <p class="text-2xs text-muted-deep mb-0.5">忽略歌曲</p>
        <p class="text-lg font-semibold" :class="totalIgnored > 0 ? 'text-warning' : 'text-muted-deep'">{{ totalIgnored }}</p>
      </div>
      <div class="section-card p-3 text-center">
        <p class="text-2xs text-muted-deep mb-0.5">版权受限</p>
        <p class="text-lg font-semibold" :class="totalCopyright > 0 ? 'text-danger' : 'text-muted-deep'">{{ totalCopyright }}</p>
      </div>
    </div>

    <!-- Filter pills -->
    <div class="flex items-center gap-1">
      <button
        v-for="f in sourceFilters" :key="f.key"
        class="px-3 py-1.5 text-sm rounded-lg transition-colors cursor-pointer"
        :class="filterType === f.key
          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium'
          : 'text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'"
        @click="filterType = f.key"
      >{{ f.label }}</button>
    </div>

    <!-- Bulk actions — playlist view only -->
    <div v-if="filterType === 'playlist'" class="flex items-center gap-2">
      <span class="text-2xs text-muted-deep mr-1">批量操作</span>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer"
        :disabled="isAnySyncing || batchLoading"
        style="background:var(--bg-surface);border:1px solid var(--border-primary);color:var(--text-secondary)"
        :class="(isAnySyncing || batchLoading) ? 'opacity-50' : 'hover:border-[var(--accent)] hover:text-accent'"
        @click="batchSync(false)"
      >
        <svg v-if="batchLoading" class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
        <svg v-else width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 00-9.9-3M2.5 8a5.5 5.5 0 009.9 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2.5 2v3.5H6M13.5 14v-3.5H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {{ batchLoading ? '同步中...' : '批量同步' }}
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer"
        :disabled="batchToggling"
        style="background:var(--bg-surface);border:1px solid var(--border-primary);color:var(--text-secondary)"
        :class="batchToggling ? 'opacity-50' : 'hover:border-success hover:text-success'"
        @click="batchToggle(true)"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {{ batchMsg && batchMsgType === 'enable' ? batchMsg : '全部启用' }}
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer"
        :disabled="batchToggling"
        style="background:var(--bg-surface);border:1px solid var(--border-primary);color:var(--text-secondary)"
        :class="batchToggling ? 'opacity-50' : 'hover:border-[var(--danger,#e74c3c)] hover:text-[var(--danger,#e74c3c)]'"
        @click="batchToggle(false)"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 8h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        {{ batchMsg && batchMsgType === 'disable' ? batchMsg : '全部禁用' }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-16">
      <span class="text-muted text-sm">加载中...</span>
    </div>

    <!-- Empty -->
    <div v-else-if="filteredSources.length === 0" class="section-card p-8">
      <EmptyState
        :title="filterType === 'album' ? '暂无已保存专辑' : '暂无同步源'"
        :description="filterType === 'album' ? '从手动下载页面可将专辑保存为来源' : '添加网易云歌单 ID 以开始同步管理'"
      >
        <template #extra>
          <button v-if="filterType !== 'album'" class="btn btn-primary mt-4" @click="openAddPlaylist">添加同步源</button>
          <NuxtLink v-else to="/manual-download" class="btn btn-primary mt-4 inline-block">去手动下载</NuxtLink>
        </template>
      </EmptyState>
    </div>

    <!-- Source list -->
    <div v-else class="section-card overflow-hidden">
      <div class="divide-y divide-[var(--border-primary)]">
        <div
          v-for="(s, idx) in filteredSources" :key="s.id"
          :draggable="filterType === 'playlist' ? 'true' : 'false'"
          class="transition-colors relative"
          :class="dragOverIdx === idx ? 'border-t-2 border-t-[var(--accent)]' : ''"
          @dragstart="onFilteredDragStart(idx, $event)"
          @dragover.prevent="onFilteredDragOver(idx)"
          @dragleave="onDragLeave"
          @drop="onFilteredDrop(idx)"
          @dragend="onDragEnd"
        >
          <!-- Row -->
          <div class="px-5 py-3.5 flex items-center gap-4" :class="dragIdx === idx ? 'opacity-50' : ''">
            <!-- Drag handle — only active in 歌单 view -->
            <span v-if="filterType === 'playlist'" class="shrink-0 cursor-grab active:cursor-grabbing" style="color:var(--text-tertiary)">
              <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
                <circle cx="4" cy="3" r="1.2" fill="currentColor"/><circle cx="8" cy="3" r="1.2" fill="currentColor"/>
                <circle cx="4" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/>
                <circle cx="4" cy="13" r="1.2" fill="currentColor"/><circle cx="8" cy="13" r="1.2" fill="currentColor"/>
              </svg>
            </span>

            <!-- Toggle (playlist only) -->
            <button
              v-if="s.type === 'playlist'"
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
                <SourceBadge :type="s.type" :subscribed="s.subscribed" />
                <p class="text-sm font-medium truncate">{{ s.name || '(待获取)' }}</p>
                <span class="text-2xs px-1.5 py-0.5 rounded" style="background:var(--bg-input);color:var(--text-secondary)">{{ s.neteasePlaylistName }}</span>
                <span v-if="s.type === 'album'" class="text-2xs px-1.5 py-0.5 rounded text-accent" style="background:var(--bg-input)">已保存专辑</span>
                <span v-else-if="!s.enabled" class="text-2xs px-1.5 py-0.5 rounded text-muted-deep" style="background:var(--bg-input)">已禁用</span>
              </div>
              <div class="flex items-center gap-3 mt-0.5">
                <span class="text-2xs" style="color:var(--text-tertiary)">ID: {{ s.neteasePlaylistId }}</span>
                <span class="text-2xs" style="color:var(--text-tertiary)">Plex: {{ s.plexPlaylistName || s.neteasePlaylistName || '自动匹配' }}</span>
                <span class="text-2xs" style="color:var(--text-tertiary)">{{ s.trackCount }} 首</span>
                <span class="text-2xs px-1.5 py-0.5 rounded shrink-0" :class="ignoredCount(s) > 0 ? 'cursor-pointer hover:opacity-80 text-warning' : 'text-muted-deep pointer-events-none'" :title="ignoredCount(s) > 0 ? `${ignoredCount(s)} 首被忽略，点击清除` : '无忽略歌曲'" style="background:var(--bg-input)" @click.stop="ignoredCount(s) > 0 && clearIgnored(s)">
                  {{ ignoredCount(s) > 0 ? `${ignoredCount(s)} 首忽略 ✕` : '无忽略' }}
                </span>
              </div>
            </div>

            <!-- Last sync -->
            <button class="text-right shrink-0 min-w-[90px] cursor-pointer group flex items-center gap-1.5 justify-end" @click="toggleExpand(s.id)">
              <div>
                <div class="flex items-center gap-1.5 justify-end">
                  <span v-if="s.lastSyncedAt || repairingSourceId === s.id" class="w-1.5 h-1.5 rounded-full shrink-0" :class="repairingSourceId === s.id ? 'bg-accent animate-pulse' : s.lastStatus === 'success' ? 'bg-success' : s.lastStatus === 'partial' ? 'bg-warning' : 'bg-danger'" />
                  <p class="text-xs" :class="repairingSourceId === s.id ? 'text-accent' : lastStatusColor(s.lastStatus)">
                    {{ repairingSourceId === s.id ? '补全中' : lastStatusLabel(s) }}
                  </p>
                </div>
                <p v-if="s.lastSyncedAt" class="text-2xs mt-0.5" style="color:var(--text-tertiary)">{{ formatRelative(s.lastSyncedAt) }}</p>
              </div>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" class="transition-transform shrink-0 opacity-40" :class="expandedId === s.id ? 'rotate-90 opacity-100' : ''" style="color:var(--text-tertiary)">
                <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>

            <!-- Icon actions -->
            <div class="flex items-center gap-0.5 shrink-0">
              <!-- Playlist: two sync buttons -->
              <template v-if="s.type === 'playlist'">
              <span class="tooltip-wrap">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer icon-btn"
                  :class="syncingSourceId === s.id ? 'icon-active' : ''"
                  :disabled="isAnySyncing || !s.enabled"
                  @click="syncSource(s)"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" class="transition-transform" :class="syncingSourceId === s.id ? 'animate-spin' : ''">
                    <path d="M13.5 8a5.5 5.5 0 00-9.9-3M2.5 8a5.5 5.5 0 009.9 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                    <path d="M2.5 2v3.5H6M13.5 14v-3.5H10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <span class="tooltip-label">同步</span>
              </span>
              <span class="tooltip-wrap">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer icon-btn"
                  :class="forceFullId === s.id ? 'icon-active' : ''"
                  :disabled="isAnySyncing"
                  @click="syncSource(s, true)"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" class="transition-transform" :class="forceFullId === s.id ? 'animate-spin' : ''">
                    <path d="M13.5 8a5.5 5.5 0 00-9.9-3M2.5 8a5.5 5.5 0 009.9 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    <path d="M2.5 2v3.5H6M13.5 14v-3.5H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    <circle cx="8" cy="8" r="2" fill="currentColor" />
                  </svg>
                </button>
                <span class="tooltip-label">全量同步</span>
              </span>
              </template>
              <!-- Album: single download button -->
              <template v-else>
              <span class="tooltip-wrap">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer icon-btn"
                  :class="syncingSourceId === s.id ? 'icon-active' : ''"
                  :disabled="isAnySyncing"
                  @click="syncSource(s, true)"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" class="transition-transform" :class="syncingSourceId === s.id ? 'animate-spin' : ''">
                    <path d="M8 2v9M4.5 8L8 11.5 11.5 8M2 13.5h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <span class="tooltip-label">{{ s.lastSyncedAt ? '重新下载' : '下载' }}</span>
              </span>
              </template>
              <!-- Edit — always visible -->
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
              <!-- More actions dropdown -->
              <span class="tooltip-wrap" style="position:relative">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer icon-btn"
                  @click.stop="toggleMoreMenu(s.id)"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <circle cx="4" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="8" r="1.5" fill="currentColor" />
                  </svg>
                </button>
                <span class="tooltip-label">更多</span>
                <!-- Dropdown menu -->
                <div
                  v-if="moreMenuId === s.id"
                  class="absolute right-0 z-20 py-1 rounded-lg shadow-lg"
                  :class="idx >= filteredSources.length - 3 ? 'bottom-full mb-1' : 'top-full mt-1'"
                  style="background:var(--bg-surface);border:1px solid var(--border-primary);min-width:140px"
                  @click.stop
                >
                  <button
                    class="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors"
                    :class="repairingSourceId === s.id ? 'text-accent' : ''"
                    :style="{ color: repairingSourceId === s.id ? 'var(--accent)' : 'var(--text-secondary)' }"
                    :disabled="isAnySyncing"
                    @click="repairSource(s); moreMenuId = null"
                  >
                    <template v-if="repairingSourceId === s.id && repairProgress[s.id]">
                      {{ repairProgress[s.id].processed }}/{{ repairProgress[s.id].total }}
                    </template>
                    <template v-else>词</template>
                    <span>补词/图</span>
                  </button>
                  <button
                    class="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors icon-delete"
                    @click="confirmDelete = s; moreMenuId = null"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M6.5 7.5v4M9.5 7.5v4M3.5 4.5l1 8.5a1 1 0 001 1h5a1 1 0 001-1l1-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <span style="color:var(--danger, #e74c3c)">删除</span>
                  </button>
                </div>
                <!-- Click-away overlay -->
                <div v-if="moreMenuId === s.id" class="fixed inset-0 z-10" @click="moreMenuId = null" />
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

    <!-- Dialogs -->
    <AddPlaylistDialog
      :visible="showAdd"
      :source-ids="sources.map(s => s.neteasePlaylistId)"
      @update:visible="showAdd = $event"
      @created="onPlaylistCreated"
      @created-album="onAlbumCreated"
    />
    <EditSourceDialog :source="editTarget" @close="editTarget = null" @saved="fetchSources" />
    <ConfirmDialog
      :visible="!!confirmDelete"
      title="删除同步源"
      :message="`确定要删除${confirmDelete?.type === 'album' ? '已保存专辑' : '同步源'}「${confirmDelete?.name}」吗？此操作不可撤销。`"
      confirm-label="删除"
      variant="danger"
      @confirm="handleDelete"
      @cancel="confirmDelete = null"
    />
  </div>
</template>

<script setup lang="ts">
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import AddPlaylistDialog from '~/components/sources/AddPlaylistDialog.vue'
import EditSourceDialog from '~/components/sources/EditSourceDialog.vue'
import { useDragReorder } from '~~/composables/useDragReorder'

const api = useApi()
const { syncingSourceId, syncSource: triggerSourceSync } = useSourceSync()
const { state: globalSyncState } = useSync()
const sources = ref<PlaylistSource[]>([])
const loading = ref(false)
const togglingId = ref<string | null>(null)
const forceFullId = ref<string | null>(null)
const repairingSourceId = ref<string | null>(null)
const repairProgress = ref<Record<string, { processed: number; total: number }>>({})

// Filter pills (replacing tabs)
const filterType = ref<'playlist' | 'album'>('playlist')
const sourceFilters = [
  { key: 'playlist' as const, label: '歌单' },
  { key: 'album' as const, label: '已保存专辑' },
]
const filteredSources = computed(() => sources.value.filter(s => s.type === filterType.value))

// Summary computed
const enabledCount = computed(() => sources.value.filter(s => s.type === 'playlist' && s.enabled).length)
const autoSyncEnabled = ref(false)

async function fetchAutoSyncStatus() {
  try {
    const cfg = await api.get<{ sync: { enabled: boolean } }>('/config')
    autoSyncEnabled.value = cfg?.sync?.enabled ?? false
  } catch { /* keep default false */ }
}
const lastSyncTime = computed(() => {
  const times = sources.value.filter(s => s.lastSyncedAt).map(s => new Date(s.lastSyncedAt!).getTime())
  if (times.length === 0) return ''
  const latest = new Date(Math.max(...times))
  return formatRelative(latest.toISOString())
})
const totalIgnored = computed(() => sources.value.reduce((sum, s) => sum + ignoredCount(s), 0))
const totalCopyright = computed(() => sources.value.reduce((sum, s) => {
  if (s.copyrightRestrictedIds) {
    try { sum += JSON.parse(s.copyrightRestrictedIds).length } catch { /* ignore */ }
  }
  return sum
}, 0))

// Add dialogs
const showAdd = ref(false)
// Edit
const editTarget = ref<PlaylistSource | null>(null)

// Drag & drop — only enabled in 歌单 view; wrapper handlers map filtered indices to sources indices
const { dragIdx, dragOverIdx, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = useDragReorder(
  sources,
  async (orderedIds) => { await api.put('/playlist-sources/reorder', { orderedIds }) },
  (s) => s.id,
)

// Wrap drag handlers to work with filteredSources indices → sources indices
function onFilteredDragStart(idx: number, e: DragEvent) {
  if (filterType.value !== 'playlist') return
  const item = filteredSources.value[idx]
  if (!item) return
  const realIdx = sources.value.findIndex(s => s.id === item!.id)
  if (realIdx >= 0) onDragStart(realIdx, e)
}
function onFilteredDragOver(idx: number) {
  if (filterType.value !== 'playlist') return
  const item = filteredSources.value[idx]
  if (!item) return
  const realIdx = sources.value.findIndex(s => s.id === item!.id)
  if (realIdx >= 0) onDragOver(realIdx)
}
function onFilteredDrop(idx: number) {
  if (filterType.value !== 'playlist') return
  const item = filteredSources.value[idx]
  if (!item) return
  const realIdx = sources.value.findIndex(s => s.id === item!.id)
  if (realIdx >= 0) onDrop(realIdx)
}

const confirmDelete = ref<PlaylistSource | null>(null)

function openAddPlaylist() { showAdd.value = true }
function onPlaylistCreated() {
  fetchSources()
  filterType.value = 'playlist'
}
function onAlbumCreated() {
  fetchSources()
  filterType.value = 'album'
}
function openEdit(s: PlaylistSource) { editTarget.value = s }

// More menu
const moreMenuId = ref<string | null>(null)
function toggleMoreMenu(id: string) {
  moreMenuId.value = moreMenuId.value === id ? null : id
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
    case 'copyright_restricted': return 'bg-[var(--warning,#f59e0b)]'
    case 'ignored_failure': return 'bg-[#71717a]'
    case 'skipped_existing': return 'bg-[var(--border-secondary)]'
    default: return 'bg-muted-deep'
  }
}

function ignoredCount(s: PlaylistSource): number {
  let n = 0
  if (s.copyrightRestrictedIds) {
    try { n += JSON.parse(s.copyrightRestrictedIds).length } catch { /* ignore */ }
  }
  if (s.ignoredFailureIds) {
    try { n += Object.keys(JSON.parse(s.ignoredFailureIds)).length } catch { /* ignore */ }
  }
  return n
}
async function clearIgnored(s: PlaylistSource) {
  try {
    await api.put(`/playlist-sources/${s.id}`, { ignoredFailureIds: null, copyrightRestrictedIds: null })
    await fetchSources()
  } catch { /* ignore */ }
}

async function fetchSources() {
  loading.value = true
  try { sources.value = await api.get<PlaylistSource[]>('/playlist-sources') } catch { /* ignore */ }
  finally { loading.value = false }
}

async function toggleEnabled(s: PlaylistSource) {
  togglingId.value = s.id
  const prev = s.enabled
  const next = !prev
  s.enabled = next
  try {
    await api.put(`/playlist-sources/${s.id}`, { enabled: next })
  } catch {
    s.enabled = prev
  } finally {
    togglingId.value = null
  }
}

async function handleDelete() {
  if (!confirmDelete.value) return
  const id = confirmDelete.value.id; confirmDelete.value = null
  try { await api.del(`/playlist-sources/${id}`); await fetchSources() } catch { /* ignore */ }
}

const isAnySyncing = computed(() => syncingSourceId.value !== null || forceFullId.value !== null || repairingSourceId.value !== null)

async function syncSource(s: PlaylistSource, forceFull = false) {
  try {
    if (forceFull) {
      if (s.type === 'album') syncingSourceId.value = s.id
      else forceFullId.value = s.id
      await api.post(`/playlist-sources/${s.id}/sync`, { forceFull: true })
    } else {
      await triggerSourceSync(s.id)
    }
  } catch {
    forceFullId.value = null
    syncingSourceId.value = null
  }
}

const batchLoading = ref(false)
const batchToggling = ref(false)
const batchMsg = ref('')
const batchMsgType = ref<'enable' | 'disable' | ''>('')

async function batchSync(forceFull: boolean) {
  batchLoading.value = true
  try {
    await api.post('/sync/trigger', { forceFull })
  } catch { /* error shown via sync state */ }
  // Loading stays true until SSE reports sync finished
}

// Track global sync via composable for batch button loading state
watch(() => globalSyncState.value?.isRunning, (running) => {
  if (!running && batchLoading.value) {
    batchLoading.value = false
    batchMsg.value = '已完成'; batchMsgType.value = 'enable'
    setTimeout(() => { batchMsg.value = ''; batchMsgType.value = '' }, 3000)
  }
})

async function batchToggle(enable: boolean) {
  batchToggling.value = true
  batchMsgType.value = enable ? 'enable' : 'disable'
  let count = 0
  for (const s of sources.value.filter(s => s.type === 'playlist')) {
    if (s.enabled !== enable) { await toggleEnabled(s); count++ }
  }
  batchMsg.value = `已${enable ? '启用' : '禁用'} ${count} 个`
  batchToggling.value = false
  setTimeout(() => { batchMsg.value = ''; batchMsgType.value = '' }, 3000)
}

async function repairSource(s: PlaylistSource) {
  if (repairingSourceId.value) return
  repairingSourceId.value = s.id
  try {
    await api.post(`/playlist-sources/${s.id}/repair`)
  } catch {
    repairingSourceId.value = null
  }
}

// SSE: clear spinners when sync finishes
const sseUnsubs: Array<() => void> = []

onMounted(() => {
  fetchSources()
  fetchAutoSyncStatus()

  sseUnsubs.push(sseSubscribe('stage-change', (data) => {
    const stage = data.stage as string
    if (stage === 'idle') {
      forceFullId.value = null
      repairingSourceId.value = null
      repairProgress.value = {}
      fetchSources()
    }
  }))
  sseUnsubs.push(sseSubscribe('repair-progress', (data) => {
    const { sourceId, processed, totalSongs } = data as Record<string, unknown>
    if (sourceId && typeof processed === 'number') {
      repairProgress.value = { ...repairProgress.value, [sourceId as string]: { processed, total: totalSongs as number } }
    }
  }))
})

onUnmounted(() => {
  for (const unsub of sseUnsubs) unsub()
})

function lastStatusLabel(s: PlaylistSource): string {
  if (!s.lastSyncedAt) return '未同步'
  switch (s.lastStatus) {
    case 'running': return '补全中'
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
