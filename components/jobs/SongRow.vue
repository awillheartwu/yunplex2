<template>
  <div class="song-row" :class="toneClass">
    <button
      class="song-row__button"
      @click="$emit('toggle')"
    >
      <!-- Status dot -->
      <div
        class="song-status-dot"
        :class="toneClass"
      />

      <!-- Info -->
      <div class="flex-1 min-w-0">
        <p class="text-sm text-[var(--text-primary)]">{{ song.songName }}</p>
        <p class="text-2xs text-muted-deep">{{ song.artist }} · {{ song.album }}</p>
      </div>

      <!-- Status badge -->
      <span class="song-status-badge" :class="toneClass">
        <AppIcon :name="statusPresentation.icon" :size="11" :class="{ 'animate-spin': song.status === 'downloading' }" />
        {{ statusLabel }}
      </span>

      <!-- Expand arrow -->
      <AppIcon name="chevronRight" :size="12" class="shrink-0 transition-transform" :class="expanded ? 'rotate-90' : ''" />
    </button>

    <!-- Expanded detail -->
    <div v-if="expanded" class="song-row__expanded">
      <div class="song-row__detail-card">
        <!-- Download progress -->
        <div v-if="retrying && retryProgress !== undefined && retryProgress > 0" class="space-y-1">
          <div class="flex justify-between text-2xs">
            <span class="text-muted-deep">下载进度</span>
            <span class="text-accent font-mono">{{ retryProgress }}%</span>
          </div>
          <div class="w-full h-1 rounded-full bg-[var(--border-primary)] overflow-hidden">
            <div class="h-full rounded-full bg-accent transition-all duration-300" :style="{ width: retryProgress + '%' }" />
          </div>
        </div>
        <!-- Skipped existing -->
        <template v-if="song.status === 'skipped_existing'">
          <p class="text-2xs text-muted-deep">歌曲已在 Plex 库中，本次未做处理</p>
        </template>

        <!-- Ignored failure -->
        <template v-else-if="song.status === 'ignored_failure'">
          <p class="text-2xs text-muted-deep">此歌曲多次下载或匹配失败，已被忽略。可按"清除忽略"重试</p>
          <button
            v-if="showRetry"
            class="btn btn-secondary btn-sm mt-2"
            :disabled="retrying"
            @click.stop="$emit('retry')"
          >{{ retrying ? '重试中...' : '重试下载' }}</button>
        </template>

        <!-- Copyright restricted -->
        <template v-else-if="song.status === 'copyright_restricted'">
          <p class="text-2xs text-muted-deep">此歌曲受版权保护，网易云不提供下载链接</p>
          <button
            v-if="showRetry"
            class="btn btn-secondary btn-sm mt-2"
            :disabled="retrying"
            @click.stop="$emit('retry')"
          >{{ retrying ? '重试中...' : '重试下载' }}</button>
        </template>

        <!-- Removed -->
        <template v-else-if="song.status === 'removed'">
          <p class="text-2xs text-muted-deep">此歌曲已从 Plex 歌单中移除（不再存在于网易云歌单）</p>
        </template>

        <!-- Success / Failed — show ops + details -->
        <template v-else>
          <button
            v-if="showRetry"
            class="btn btn-secondary btn-sm mb-2"
            :disabled="retrying"
            @click.stop="$emit('retry')"
          >{{ retrying ? '重试中...' : '重试下载' }}</button>
          <div v-if="song.ops" class="flex items-center gap-4 mb-2">
            <span class="inline-flex items-center gap-1 text-2xs" :class="song.ops.download === 'ok' ? 'text-success' : 'text-danger'">
              <AppIcon :name="song.ops.download === 'ok' ? 'check' : 'x'" :size="11" /> 下载
            </span>
            <span v-if="song.ops.lyric !== 'skipped'" class="inline-flex items-center gap-1 text-2xs" :class="song.ops.lyric === 'ok' ? 'text-success' : 'text-danger'">
              <AppIcon :name="song.ops.lyric === 'ok' ? 'check' : 'x'" :size="11" /> 歌词
            </span>
            <span v-if="song.ops.tags !== 'skipped'" class="inline-flex items-center gap-1 text-2xs" :class="song.ops.tags === 'ok' ? 'text-success' : 'text-danger'">
              <AppIcon :name="song.ops.tags === 'ok' ? 'check' : 'x'" :size="11" /> 标签
            </span>
            <span v-if="song.ops.cover !== 'skipped'" class="inline-flex items-center gap-1 text-2xs" :class="song.ops.cover === 'ok' ? 'text-success' : 'text-danger'">
              <AppIcon :name="song.ops.cover === 'ok' ? 'check' : 'x'" :size="11" /> 封面
            </span>
          </div>

          <template v-if="song.filePath">
            <div class="flex justify-between text-2xs">
              <span class="text-muted-deep">文件路径</span>
              <span class="text-muted font-mono truncate max-w-[280px]">{{ song.filePath }}</span>
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
            <div v-if="song.metadata.trackNumber" class="flex justify-between text-2xs">
              <span class="text-muted-deep">曲目号</span>
              <span class="text-muted">{{ song.metadata.trackNumber }}</span>
            </div>
          </template>
        </template>
        <ErrorPanel v-if="song.error" :error="song.error" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SongTask } from '~~/server/lib/job/types'
import {
  isFailedSongStatus,
  isIgnoredSongStatus,
  semanticToneClass,
  songStatusPresentation,
} from '~~/lib/task-status'

const props = defineProps<{ song: SongTask; expanded: boolean; retrying?: boolean; retryProgress?: number }>()
defineEmits<{ toggle: []; retry: [] }>()

const showRetry = computed(() => {
  return (isFailedSongStatus(props.song.status) || isIgnoredSongStatus(props.song.status))
    && !!props.song.neteaseSongId
})

const statusPresentation = computed(() => songStatusPresentation(props.song.status))
const toneClass = computed(() => semanticToneClass(statusPresentation.value.tone))
const statusLabel = computed(() => statusPresentation.value.label)

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  const min = Math.floor(sec / 60)
  const s = String(sec % 60).padStart(2, '0')
  return `${min}:${s}`
}
</script>

<style scoped>
.song-row{border-left:3px solid;border-left-color:currentColor}
.song-row__button{display:flex;width:100%;align-items:center;gap:1rem;padding:.75rem 1.25rem;border:0;background:transparent;text-align:left;cursor:pointer;transition:background 150ms ease}
.song-row__button:hover{background:color-mix(in srgb,currentColor 7%,var(--bg-surface))}
.song-status-dot{width:.5rem;height:.5rem;flex:none;border:0;border-radius:999px;background:currentColor}
.song-status-badge{display:inline-flex;align-items:center;gap:.3rem;flex:none;padding:.18rem .5rem;border:1px solid;border-radius:.45rem;font-size:.68rem;font-weight:700}
.song-row__expanded{padding:0 1.25rem 1rem 3rem}
.song-row__detail-card{display:flex;flex-direction:column;gap:.5rem;padding:.75rem;border:1px solid var(--border-primary);border-radius:var(--radius-md);background:var(--bg-app)}
</style>
