<template>
  <div class="mt-2 border rounded-lg p-3" style="background: var(--danger-soft); border-color: var(--danger-border)">
    <div class="flex items-start gap-2">
      <AppIcon name="warn" :size="14" class="shrink-0 mt-0.5 text-danger" />
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
