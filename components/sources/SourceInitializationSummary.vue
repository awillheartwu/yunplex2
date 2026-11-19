<script setup lang="ts">
import type { SourceInitializationSummary } from '../../composables/useSourceInitialization'

defineProps<{
  initialization: SourceInitializationSummary
  acting: boolean
  canCommit: boolean
}>()

const emit = defineEmits<{ commit: [] }>()
</script>

<template>
  <footer class="source-adoption__commit"><div><strong>本次歌曲安排</strong><span>继续使用 {{ initialization.preservedItems }} 首 · 选用 Plex {{ initialization.adoptItems }} 首 · 下载 {{ initialization.downloadItems }} 首 · 暂不加入 {{ initialization.deferredItems }} 首。开始后自动下载并更新 Plex 歌单，不改变以后的自动同步开关。</span></div><button class="btn btn-primary" :disabled="acting || !canCommit" @click="emit('commit')">开始下载并同步</button></footer>
</template>

<style scoped>
@import '~/assets/css/components/source-initialization-summary.css';
</style>
