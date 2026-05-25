<template>
  <div class="mt-2 bg-[#e74c3c08] border border-[#e74c3c20] rounded-lg p-3">
    <div class="flex items-start gap-2">
      <svg class="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M8 6v3M8 11v0M1.5 13.5h13L8 2.5 1.5 13.5z" stroke="#e74c3c" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="flex-1 min-w-0">
        <p class="text-sm text-danger font-medium">{{ error.title }}</p>
        <p class="text-sm text-[var(--text-primary)] mt-1">{{ error.message }}</p>

        <div v-if="error.songName || error.artist || error.stage" class="flex items-center gap-4 mt-2 text-2xs text-muted-deep">
          <span v-if="error.songName">歌曲: {{ error.songName }}</span>
          <span v-if="error.artist">艺人: {{ error.artist }}</span>
          <span v-if="error.stage">阶段: {{ stageLabel(error.stage) }}</span>
        </div>

        <div v-if="error.context && Object.keys(error.context).length > 0" class="mt-2 text-2xs text-muted-deep">
          <span class="text-muted">上下文:</span>
          <pre class="mt-1 p-2 bg-[var(--bg-app)] rounded text-2xs font-mono overflow-x-auto">{{ JSON.stringify(error.context, null, 2) }}</pre>
        </div>

        <details v-if="error.stack" class="mt-2">
          <summary class="text-2xs text-muted-deep cursor-pointer hover:text-muted">查看堆栈</summary>
          <pre class="mt-1 p-2 bg-[var(--bg-app)] rounded text-2xs font-mono text-muted overflow-x-auto">{{ error.stack }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { StepError } from '~~/server/lib/job/types'

defineProps<{ error: StepError }>()

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    fetch_playlist: '获取歌单',
    compare: '对比歌单',
    download: '下载歌曲',
    write_tags: '写入标签',
    refresh_plex: '刷新 Plex',
    plex_match: 'Plex 匹配',
    plex_insert: 'Plex 插入',
    update_playlist: '更新歌单',
  }
  return labels[stage] || stage
}
</script>
