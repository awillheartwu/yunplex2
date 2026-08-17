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
          <p v-if="!matchTrace" class="text-2xs text-muted-deep">历史记录未保存匹配证据。</p>
        </template>

        <!-- Ignored failure -->
        <template v-else-if="song.status === 'ignored_failure'">
          <p class="text-2xs text-muted-deep">此歌曲已达到连续失败阈值，系统已暂停自动重试。重新尝试时会先清除该歌曲的失败缓存。</p>
          <button
            v-if="showRetry"
            class="btn btn-secondary btn-sm mt-2"
            :disabled="retrying"
            :aria-label="retrying ? `正在重新尝试 ${song.songName}` : `清除 ${song.songName} 的失败缓存并重新尝试`"
            @click.stop="$emit('retry')"
          >{{ retrying ? '重试中...' : '重新尝试' }}</button>
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
          <p v-if="!matchTrace" class="text-2xs text-muted-deep">历史记录未保存删除证据。</p>
        </template>

        <!-- Extra skipped -->
        <template v-else-if="song.status === 'extra_skipped'">
          <p class="text-2xs text-muted-deep">此歌曲存在于 Plex 歌单，但不在本轮网易云目标中。由于本轮目标不完整或开启了保留额外歌曲，系统未删除它。</p>
          <p v-if="matchTrace?.deletionProtectionReason" class="text-2xs text-warning">{{ matchTrace.deletionProtectionReason }}</p>
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
          <div v-if="matchTrace" class="song-row__match-trace">
            <div class="flex justify-between gap-3 text-2xs">
              <span class="text-muted-deep">匹配方式</span>
              <span class="text-muted text-right">{{ matchTraceLabel }}</span>
            </div>
            <div v-if="matchTrace.identity?.plexFilePath" class="flex justify-between gap-3 text-2xs">
              <span class="text-muted-deep">身份路径</span>
              <span class="text-muted font-mono text-right truncate max-w-[280px]">{{ matchTrace.identity.plexFilePath }}</span>
            </div>
            <p v-if="matchTrace.deletionProtectionReason" class="text-2xs text-warning">{{ matchTrace.deletionProtectionReason }}</p>
          </div>
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
type Trace = {
  source?: string; message?: string; decision?: string; deletionProtectionReason?: string
  identity?: { method?: string; plexFilePath?: string }
}
const matchTrace = computed(() => props.song.metadata?.matchTrace as Trace | undefined)
const matchTraceLabel = computed(() => {
  const trace = matchTrace.value
  if (!trace) return ''
  const methods: Record<string, string> = {
    manual: '明确接管的 Plex 媒体', path: '托管文件精确路径',
  }
  if (trace.identity?.method) return methods[trace.identity.method] || trace.identity.method
  if (trace.decision === 'preserved') return '删除保护：保留旧项'
  return trace.message || trace.source || '历史数据未验证'
})

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
.song-row__match-trace{display:flex;flex-direction:column;gap:.35rem;padding-top:.55rem;border-top:1px solid var(--border-primary)}
</style>
