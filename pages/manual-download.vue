<template>
  <div>
    <h2 class="text-sm font-semibold" style="color: var(--text-primary)">手动下载</h2>
    <p class="text-2xs text-muted mt-0.5 mb-6">粘贴网易云链接或 ID，解析预览后下载资源到本地</p>

    <!-- ═══ Top workspace = fixed height ═══ -->
    <div class="shrink-0 pb-4">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5" style="min-height: 340px">
        <!-- ── Left: Input + Config ── -->
        <section class="section-card p-4 flex flex-col">
          <h3 class="text-xs font-semibold mb-3" style="color: var(--text-primary)">
            资源解析
          </h3>

          <!-- Input area -->
          <textarea
            v-model="inputValue"
            class="form-input flex-1 resize-none"
            style="min-height: 100px"
            :placeholder="placeholderText"
            :disabled="parseState === 'parsing'"
            @keydown.enter.ctrl="handleParse"
            @paste="onPaste"
          />

          <!-- Detection hint / error -->
          <div v-if="detectHint && parseState === 'preview'" class="flex items-center gap-2 mt-2">
            <span class="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
            <span class="text-2xs text-success">{{ detectHint }}</span>
            <span class="text-2xs text-muted-deep">· ID: {{ neteaseId }}</span>
          </div>
          <div v-if="error" class="flex items-center gap-2 mt-2">
            <span class="text-2xs text-danger">{{ error }}</span>
          </div>

          <!-- Download result notice -->
          <div
            v-if="downloadResult"
            class="flex items-center gap-3 mt-3 px-3 py-2 rounded-md"
            style="background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2)"
          >
            <span class="text-xs text-success font-medium">
              下载已启动，共 {{ downloadResult.total }} 首歌曲
            </span>
            <NuxtLink
              v-if="resourceType && resourceType !== 'songs' && neteaseId"
              to="/sync-sources"
              class="text-2xs text-accent hover:underline"
            >
              查看同步源
            </NuxtLink>
          </div>

          <!-- Save-as-source error -->
          <div
            v-if="saveError"
            class="flex items-center gap-2 mt-3 px-3 py-2 rounded-md"
            style="background: rgba(231,76,60,0.08); border: 1px solid rgba(231,76,60,0.2)"
          >
            <span class="text-xs text-danger">{{ saveError }}</span>
            <button class="text-2xs text-accent hover:underline shrink-0" @click="saveError = ''">✕</button>
          </div>

          <!-- Options row -->
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
            <div class="flex items-center gap-1.5">
              <span class="text-2xs text-muted-deep shrink-0">音质</span>
              <select v-model="quality" class="form-input text-2xs" style="width: auto; padding: 0.25rem 1.5rem 0.25rem 0.5rem; font-size: 0.6875rem; height: 1.625rem; background-position: right 0.4rem center;">
                <option value="jymaster">臻品母带</option>
                <option value="jyeffect">臻品</option>
                <option value="hires">Hi-Res</option>
                <option value="lossless">无损</option>
                <option value="exhigh">极高</option>
                <option value="higher">较高</option>
                <option value="standard">标准</option>
              </select>
            </div>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="downloadLyrics" type="checkbox" class="w-3.5 h-3.5" />
              <span class="text-2xs text-muted-deep">歌词</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="downloadImages" type="checkbox" class="w-3.5 h-3.5" />
              <span class="text-2xs text-muted-deep">封面</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="embedMetadata" type="checkbox" class="w-3.5 h-3.5" />
              <span class="text-2xs text-muted-deep">元数据</span>
            </label>
          </div>

          <!-- Action buttons — state-machine driven -->
          <div class="flex items-center gap-3 mt-4">
            <!-- idle: 解析 is primary -->
            <template v-if="parseState === 'idle'">
              <button
                class="btn btn-primary"
                :disabled="!inputValue.trim()"
                @click="handleParse"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M14 14L10 10M6.5 11.5a5 5 0 100-10 5 5 0 000 10z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                <span>解析</span>
              </button>
            </template>

            <!-- parsing: all disabled -->
            <template v-else-if="parseState === 'parsing'">
              <button class="btn btn-primary" disabled>
                <svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
                </svg>
                <span>解析中...</span>
              </button>
            </template>

            <!-- preview: 下载 is primary, 下载并保存为同步源 is secondary, 重新解析 is ghost -->
            <template v-else-if="parseState === 'preview'">
              <button
                class="btn btn-primary"
                :disabled="downloading || selectedCount === 0"
                @click="handleDownload"
              >
                <svg
                  v-if="downloading"
                  class="animate-spin"
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v9m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span>{{ downloading ? '启动中...' : `下载${selectedCount > 0 ? ' (' + selectedCount + ')' : ''}` }}</span>
              </button>
              <button
                v-if="resourceType && resourceType !== 'songs'"
                class="btn btn-secondary"
                :disabled="downloading || selectedCount === 0"
                @click="handleDownloadAndSave"
              >
                下载并保存为同步源
              </button>
              <button
                class="btn btn-ghost"
                @click="handleParse"
              >
                重新解析
              </button>
            </template>
          </div>
        </section>

        <!-- ── Right: Parse Preview ── -->
        <section class="section-card p-4 flex flex-col overflow-hidden">
          <!-- Idle placeholder -->
          <div
            v-if="parseState === 'idle'"
            class="flex-1 flex flex-col items-center justify-center gap-3"
          >
            <svg
              width="36" height="36" viewBox="0 0 24 24" fill="none"
              style="color: var(--border-secondary)"
            >
              <path d="M9 12h6M12 9v6M4 4l16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              <rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" stroke-width="1.5" />
            </svg>
            <p class="text-sm" style="color: var(--text-tertiary)">解析预览</p>
            <p class="text-2xs" style="color: var(--text-tertiary); opacity: 0.6">
              输入链接或 ID 后点击解析，将在此处显示预览
            </p>
          </div>

          <!-- Parsing skeleton -->
          <div v-else-if="parseState === 'parsing'" class="flex-1 flex flex-col gap-4">
            <div class="flex items-center gap-4">
              <div class="w-20 h-20 rounded-lg bg-[var(--bg-input)] animate-pulse shrink-0" />
              <div class="flex-1 space-y-3">
                <div class="h-4 bg-[var(--bg-input)] animate-pulse rounded w-2/3" />
                <div class="h-3 bg-[var(--bg-input)] animate-pulse rounded w-1/3" />
                <div class="h-3 bg-[var(--bg-input)] animate-pulse rounded w-1/2" />
              </div>
            </div>
            <div class="space-y-2 flex-1 overflow-hidden">
              <div v-for="i in 6" :key="i" class="h-8 bg-[var(--bg-input)] animate-pulse rounded" />
            </div>
          </div>

          <!-- Preview content -->
          <template v-else-if="parseState === 'preview'">
            <!-- Header: cover + info -->
            <div class="flex items-start gap-4 mb-3">
              <div
                class="w-20 h-20 rounded-lg bg-[var(--bg-input)] shrink-0 overflow-hidden"
                style="border: 1px solid var(--border-primary)"
              >
                <img
                  v-if="coverUrl"
                  :src="coverUrl"
                  :alt="title"
                  class="w-full h-full object-cover"
                  @error="(e) => { (e.target as HTMLImageElement).style.display = 'none' }"
                />
                <div
                  v-if="!coverUrl"
                  class="w-full h-full flex items-center justify-center"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="color: var(--border-secondary)">
                    <path d="M9 17V7l8 5-8 5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </div>
              </div>
              <div class="flex-1 min-w-0">
                <h4
                  class="text-sm font-semibold truncate"
                  :title="title"
                  style="color: var(--text-primary)"
                >
                  {{ title }}
                </h4>
                <p
                  v-if="artist"
                  class="text-xs truncate mt-0.5"
                  :title="artist"
                  style="color: var(--text-secondary)"
                >
                  {{ artist }}
                </p>
                <div class="flex items-center gap-2 mt-1.5">
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium"
                    :class="typeBadgeClass"
                  >
                    {{ typeLabel }}
                  </span>
                  <span class="text-2xs" style="color: var(--text-tertiary)">
                    {{ trackCount }} 首歌曲
                  </span>
                </div>
                <p
                  v-if="albumInfo?.company"
                  class="text-2xs mt-1"
                  style="color: var(--text-tertiary)"
                >
                  {{ albumInfo.company }}{{ albumInfo.publishTime ? ' · ' + new Date(albumInfo.publishTime).getFullYear() : '' }}
                </p>
              </div>
            </div>

            <!-- Track list header -->
            <div
              class="flex items-center justify-between py-2"
              style="border-bottom: 1px solid var(--border-primary)"
            >
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :indeterminate.prop="!allSelected && selectedCount > 0"
                  @change="toggleAll"
                />
                <span class="text-2xs" style="color: var(--text-secondary)">
                  {{ allSelected ? '取消全选' : '全选' }}
                  <span v-if="selectedCount > 0 && selectedCount < trackCount" style="color: var(--text-tertiary)">
                    ({{ selectedCount }}/{{ trackCount }})
                  </span>
                </span>
              </label>
            </div>

            <!-- Track list -->
            <div class="flex-1 overflow-y-auto -mx-1 px-1" style="max-height: 300px">
              <div
                v-for="(track, idx) in tracks"
                :key="track.id"
                class="flex items-center gap-3 py-1.5 px-1 rounded transition-colors hover:bg-[var(--bg-hover)]"
              >
                <input
                  type="checkbox"
                  :checked="track.selected"
                  @change="toggleTrack(track.id)"
                />
                <span class="text-2xs w-5 text-right shrink-0" style="color: var(--text-tertiary)">
                  {{ idx + 1 }}
                </span>
                <div class="flex-1 min-w-0">
                  <p class="text-xs truncate" style="color: var(--text-primary)">
                    {{ track.name }}
                  </p>
                  <p class="text-2xs truncate" style="color: var(--text-tertiary)">
                    {{ track.artists.map((a) => a.name).join(' / ') }} · {{ track.album.name }}
                  </p>
                </div>
              </div>

              <div
                v-if="tracks.length === 0"
                class="flex items-center justify-center py-8"
              >
                <span class="text-2xs text-muted-deep">暂无歌曲</span>
              </div>
            </div>
          </template>
        </section>
      </div>
    </div>

    <!-- ═══ Bottom: Tabs ═══ -->
    <div class="flex flex-col pb-6" style="min-height: 300px">
      <div class="section-card flex flex-col flex-1 min-h-0 overflow-hidden">
        <!-- Tab headers -->
        <div class="flex items-center shrink-0" style="border-bottom: 1px solid var(--border-primary)">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="px-4 py-2.5 text-xs font-medium transition-colors relative cursor-pointer"
            :style="{ color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-tertiary)' }"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
            <div
              v-if="activeTab === tab.key"
              class="absolute bottom-0 left-4 right-4 h-0.5 rounded-full"
              style="background: var(--accent)"
            />
          </button>
        </div>

        <!-- Tab: Current Queue -->
        <div v-if="activeTab === 'queue'" class="flex-1 overflow-y-auto p-4">
          <!-- Queue stats bar -->
          <div class="flex items-center gap-4 mb-4">
            <div
              v-for="stat in queueStats"
              :key="stat.key"
              class="flex items-center gap-1.5"
            >
              <span
                class="w-2 h-2 rounded-full shrink-0"
                :style="{ background: stat.color }"
              />
              <span class="text-2xs" style="color: var(--text-secondary)">
                {{ stat.label }}
              </span>
              <span class="text-2xs font-semibold" style="color: var(--text-primary)">
                {{ stat.count }}
              </span>
            </div>
          </div>

          <!-- Active tasks -->
          <div v-if="activeTasks.length > 0" class="space-y-2">
            <div
              v-for="task in activeTasks"
              :key="task.id"
              class="flex items-center gap-3 px-3 py-2 rounded-md"
              style="background: var(--bg-input); border: 1px solid var(--border-primary)"
            >
              <div
                class="w-1.5 h-1.5 rounded-full shrink-0"
                :style="{ background: task.status === 'downloading' ? 'var(--accent)' : task.status === 'tagging' ? '#f59e0b' : '#22c55e' }"
              />
              <div class="flex-1 min-w-0">
                <p class="text-xs truncate" style="color: var(--text-primary)">
                  {{ task.songName }}
                </p>
                <p class="text-2xs truncate" style="color: var(--text-tertiary)">
                  {{ task.artist }} · {{ task.quality || 'jymaster' }} · {{ statusLabel(task.status) }}
                </p>
              </div>
              <div
                v-if="task.status === 'downloading' || task.status === 'tagging'"
                class="h-1 flex-1 max-w-20 rounded-full bg-[var(--border-primary)] overflow-hidden shrink-0"
              >
                <div
                  class="h-full rounded-full transition-all duration-300"
                  style="background: var(--accent)"
                  :style="{ width: task.progress + '%' }"
                />
              </div>
              <span v-else class="text-2xs text-muted-deep shrink-0">
                {{ task.status === 'done' ? '完成' : '等待' }}
              </span>
            </div>
          </div>

          <div
            v-else-if="!loading"
            class="flex items-center justify-center py-12"
          >
            <span class="text-sm" style="color: var(--text-tertiary)">
              当前没有正在进行的下载任务
            </span>
          </div>

          <div v-else class="flex items-center justify-center py-12">
            <span class="text-sm text-muted-deep">加载中...</span>
          </div>
        </div>

        <!-- Tab: Recent Downloads -->
        <div v-if="activeTab === 'recent'" class="flex-1 overflow-y-auto p-4">
          <div v-if="recentItems.length > 0" class="space-y-1">
            <div
              v-for="item in recentItems"
              :key="item.id"
              class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
            >
              <div class="flex-1 min-w-0">
                <p class="text-xs truncate" style="color: var(--text-primary)">
                  {{ item.songName }}
                </p>
                <p class="text-2xs truncate" style="color: var(--text-tertiary)">
                  {{ item.artist }} · {{ item.quality || 'jymaster' }}
                </p>
              </div>
              <div class="text-right shrink-0">
                <p class="text-2xs" style="color: var(--text-secondary)">
                  {{ item.filePath || '-' }}
                </p>
                <p class="text-2xs" style="color: var(--text-tertiary)">
                  {{ formatTime(item.createdAt) }}
                </p>
              </div>
              <span
                class="text-2xs px-1.5 py-0.5 rounded shrink-0"
                :style="{
                  background: item.status === 'done' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  color: item.status === 'done' ? '#22c55e' : '#ef4444',
                }"
              >
                {{ item.status === 'done' ? '完成' : '失败' }}
              </span>
            </div>
          </div>

          <div
            v-else-if="!loading"
            class="flex flex-col items-center justify-center py-12 gap-2"
          >
            <span class="text-sm" style="color: var(--text-tertiary)">
              暂无最近的下载记录
            </span>
          </div>

          <div v-else class="flex items-center justify-center py-12">
            <span class="text-sm text-muted-deep">加载中...</span>
          </div>

          <!-- Footer link -->
          <div class="flex items-center justify-between mt-4 pt-3" style="border-top: 1px solid var(--border-primary)">
            <span class="text-2xs" style="color: var(--text-tertiary)">
              显示最近 {{ recentItems.length }} 条下载记录
            </span>
            <NuxtLink to="/task-center" class="text-2xs text-accent hover:underline">
              查看全部历史 → 任务中心
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { URL_PATTERNS } from '~~/composables/useManualDownload'

const {
  parseState,
  inputValue,
  resourceType,
  detectHint,
  title,
  artist,
  coverUrl,
  tracks,
  neteaseId,
  trackCount,
  albumInfo,
  quality,
  downloadLyrics,
  downloadImages,
  embedMetadata,
  // plexEnabled not exposed — one-shot downloads stay local; bridge to Plex via "save as sync source"
  error,
  saveError,
  downloadResult,
  downloading,
  allSelected,
  selectedCount,
  parse,
  download,
  downloadAndSave,
  toggleAll,
  toggleTrack,
} = useManualDownload()

const {
  queueStatus,
  activeTasks,
  historyItems,
  loading,
} = useDownloadQueue()

// ── Tabs ──
const activeTab = ref<'queue' | 'recent'>('queue')
const tabs = [
  { key: 'queue' as const, label: '当前下载队列' },
  { key: 'recent' as const, label: '最近下载' },
]

// ── Derived ──
const placeholderText = '粘贴网易云链接或输入 ID，自动识别歌单/专辑/单曲\n\n支持格式：\n· 链接：https://music.163.com/playlist?id=123456\n· 歌单/专辑/单曲 ID 纯数字\n· 多首歌曲 ID（换行或逗号分隔）\n· Ctrl+Enter 快捷解析'

const typeLabel = computed(() => {
  if (resourceType.value === 'playlist') return '歌单'
  if (resourceType.value === 'album') return '专辑'
  if (resourceType.value === 'songs') return '单曲'
  return ''
})

const typeBadgeClass = computed(() => {
  if (resourceType.value === 'playlist') return 'bg-[rgba(99,102,241,0.12)] text-accent'
  if (resourceType.value === 'album') return 'bg-[rgba(34,197,94,0.12)] text-success'
  if (resourceType.value === 'songs') return 'bg-[rgba(245,158,11,0.12)] text-warning'
  return ''
})

const queueStats = computed(() => [
  { key: 'pending', label: '等待', count: queueStatus.value.pending, color: 'var(--text-tertiary)' },
  { key: 'downloading', label: '下载中', count: queueStatus.value.downloading, color: 'var(--accent)' },
  { key: 'tagging', label: '标记中', count: queueStatus.value.tagging, color: '#f59e0b' },
  { key: 'done', label: '已完成', count: queueStatus.value.done, color: '#22c55e' },
  { key: 'failed', label: '失败', count: queueStatus.value.failed, color: '#ef4444' },
])

// Last ~30 recent downloads (done + failed, sorted by time desc)
const recentItems = computed(() =>
  historyItems.value.slice(0, 30),
)

// ── Actions ──
function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') || ''
  // Use same URL patterns as the parser for consistent detection
  if (URL_PATTERNS.some(p => p.pattern.test(text))) {
    // Auto-parse when a recognizable Netease URL is pasted
    nextTick(() => {
      if (inputValue.value.trim()) {
        handleParse()
      }
    })
  }
}

async function handleParse() {
  await parse()
}

async function handleDownload() {
  await download()
}

async function handleDownloadAndSave() {
  await downloadAndSave()
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: '等待中',
    downloading: '下载中',
    tagging: '写入标签',
    done: '已完成',
    failed: '失败',
  }
  return map[status] || status
}

function formatTime(iso: string) {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours} 小时前`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays} 天前`
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch {
    return iso.slice(0, 10)
  }
}

// ── Reset on unmount ──
onUnmounted(() => {
  // Keep page state for navigation, but reset if navigating away permanently
})
</script>
