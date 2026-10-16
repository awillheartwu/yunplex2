<script setup lang="ts">
import type { SourceInitializationSummary } from '../../composables/useSourceInitialization'

defineProps<{
  initialization: SourceInitializationSummary
  queueDepth: number
  downloadConcurrency: number
  acting: boolean
  canCommit: boolean
}>()

const emit = defineEmits<{ commit: [] }>()
</script>

<template>
  <footer class="source-adoption__commit"><div><strong>当前选择</strong><span>使用 Plex {{ initialization.adoptItems }} 首 · 下载 {{ initialization.downloadItems }} 首 · 暂缓 {{ initialization.deferredItems }} 首 · 冲突 {{ initialization.conflictItems }} 首。提交后，启用中的收藏会继续下载并更新 Plex 歌单；暂停的收藏需手动同步。</span></div><button class="btn btn-primary" :disabled="acting || !canCommit" @click="emit('commit')">提交接管方案</button></footer>
</template>

<style scoped>
@import '~/assets/css/components/source-initialization-summary.css';
</style>
