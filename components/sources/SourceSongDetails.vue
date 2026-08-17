<template>
  <div v-if="loading" class="text-2xs text-muted py-2">加载中...</div>
  <div v-else-if="songs.length === 0" class="text-2xs text-muted py-2">暂无歌曲记录</div>
  <div v-else :class="mobile ? 'grid grid-cols-1 gap-y-2' : 'grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-3'">
    <div v-for="song in songs" :key="song.id" class="flex items-center gap-2 text-xs min-w-0">
      <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="statusDotClass(song.status)" />
      <span class="truncate" style="color:var(--text-primary)">{{ song.songName }}</span>
      <span class="text-muted-deep truncate">{{ song.artist }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface SourceSongSummary {
  id: string
  songName: string
  artist: string
  status: string
}

withDefaults(defineProps<{
  songs: SourceSongSummary[]
  loading: boolean
  mobile?: boolean
}>(), {
  mobile: false,
})

function statusDotClass(status: string): string {
  switch (status) {
    case 'success': return 'bg-success'
    case 'failed_download':
    case 'failed_tags': return 'bg-danger'
    case 'failed_plex_match':
    case 'failed_plex_insert': return 'bg-warning'
    case 'copyright_restricted':
    case 'ignored_failure': return 'bg-ignored'
    case 'skipped_existing': return 'bg-existing'
    default: return 'bg-muted-deep'
  }
}
</script>
