<template>
  <div>
    <button
      class="w-full text-left px-5 py-3 flex items-center gap-4 hover:bg-[var(--bg-surface)] transition-colors"
      @click="$emit('toggle')"
    >
      <!-- Status dot -->
      <div
        class="w-2 h-2 rounded-full shrink-0"
        :class="statusDot"
      />

      <!-- Info -->
      <div class="flex-1 min-w-0">
        <p class="text-sm text-[var(--text-primary)]">{{ song.songName }}</p>
        <p class="text-2xs text-muted-deep">{{ song.artist }} · {{ song.album }}</p>
      </div>

      <!-- Status badge -->
      <span class="text-2xs px-2 py-0.5 rounded font-medium shrink-0" :class="statusBadge">
        {{ statusLabel }}
      </span>

      <!-- Expand arrow -->
      <svg
        class="shrink-0 transition-transform"
        :class="expanded ? 'rotate-90' : ''"
        width="12" height="12" viewBox="0 0 16 16" fill="none"
      >
        <path d="M6 3l5 5-5 5" stroke="#6b6b6b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <!-- Expanded detail -->
    <div v-if="expanded" class="px-5 pb-4 pl-12">
      <div class="bg-[var(--bg-app)] rounded-lg p-3 space-y-2">
        <!-- Operations status -->
        <div v-if="song.ops" class="flex items-center gap-4 mb-2">
          <span class="text-2xs" :class="song.ops.download === 'ok' ? 'text-success' : 'text-danger'">
            {{ song.ops.download === 'ok' ? '✓' : '✗' }} 下载
          </span>
          <span v-if="song.ops.lyric !== 'skipped'" class="text-2xs" :class="song.ops.lyric === 'ok' ? 'text-success' : 'text-danger'">
            {{ song.ops.lyric === 'ok' ? '✓' : '✗' }} 歌词
          </span>
          <span v-if="song.ops.tags !== 'skipped'" class="text-2xs" :class="song.ops.tags === 'ok' ? 'text-success' : 'text-danger'">
            {{ song.ops.tags === 'ok' ? '✓' : '✗' }} 标签
          </span>
          <span v-if="song.ops.cover !== 'skipped'" class="text-2xs" :class="song.ops.cover === 'ok' ? 'text-success' : 'text-danger'">
            {{ song.ops.cover === 'ok' ? '✓' : '✗' }} 封面
          </span>
        </div>

        <template v-if="song.filePath">
          <div class="flex justify-between text-2xs">
            <span class="text-muted-deep">文件路径</span>
            <span class="text-muted font-mono">{{ song.filePath }}</span>
          </div>
          <div class="flex justify-between text-2xs">
            <span class="text-muted-deep">格式</span>
            <span class="text-muted">{{ song.fileType?.toUpperCase() }}</span>
          </div>
        </template>
        <template v-if="song.metadata">
          <div v-if="song.metadata.quality" class="flex justify-between text-2xs">
            <span class="text-muted-deep">音质</span>
            <span class="text-muted">{{ song.metadata.quality }}</span>
          </div>
          <div v-if="song.metadata.duration" class="flex justify-between text-2xs">
            <span class="text-muted-deep">时长</span>
            <span class="text-muted">{{ formatDuration(song.metadata.duration) }}</span>
          </div>
          <div v-if="song.metadata.disc" class="flex justify-between text-2xs">
            <span class="text-muted-deep">碟号</span>
            <span class="text-muted">{{ song.metadata.disc }}</span>
          </div>
          <div v-if="song.metadata.releaseDate" class="flex justify-between text-2xs">
            <span class="text-muted-deep">发行日期</span>
            <span class="text-muted">{{ song.metadata.releaseDate }}</span>
          </div>
          <div v-if="song.metadata.genre" class="flex justify-between text-2xs">
            <span class="text-muted-deep">流派</span>
            <span class="text-muted">{{ song.metadata.genre }}</span>
          </div>
          <div v-if="song.metadata.label" class="flex justify-between text-2xs">
            <span class="text-muted-deep">厂牌</span>
            <span class="text-muted">{{ song.metadata.label }}</span>
          </div>
        </template>
        <ErrorPanel v-if="song.error" :error="song.error" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SongTask } from '~~/server/lib/job/types'

const props = defineProps<{ song: SongTask; expanded: boolean }>()
defineEmits<{ toggle: [] }>()

const statusConfig = computed(() => {
  switch (props.song.status) {
    case 'success': return { dot: 'bg-success', badge: 'bg-[#2ecc7120] text-success', label: '成功' }
    case 'skipped_existing': return { dot: 'bg-muted-deep', badge: 'bg-[#6b6b6b20] text-muted-deep', label: '已存在' }
    case 'removed': return { dot: 'bg-warning', badge: 'bg-[#f1c40f20] text-warning', label: '已移除' }
    case 'failed_download': return { dot: 'bg-danger', badge: 'bg-[#e74c3c20] text-danger', label: '下载失败' }
    case 'failed_tags': return { dot: 'bg-danger', badge: 'bg-[#e74c3c20] text-danger', label: '标签失败' }
    case 'failed_plex_match': return { dot: 'bg-warning', badge: 'bg-[#f1c40f20] text-warning', label: 'Plex 匹配失败' }
    case 'failed_plex_insert': return { dot: 'bg-warning', badge: 'bg-[#f1c40f20] text-warning', label: 'Plex 插入失败' }
    default: return { dot: 'bg-[#4a4a4a]', badge: 'bg-[#6b6b6b20] text-muted', label: '等待中' }
  }
})

const statusDot = computed(() => statusConfig.value.dot)
const statusBadge = computed(() => statusConfig.value.badge)
const statusLabel = computed(() => statusConfig.value.label)

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  const min = Math.floor(sec / 60)
  const s = String(sec % 60).padStart(2, '0')
  return `${min}:${s}`
}
</script>
