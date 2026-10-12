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
  <footer class="source-adoption__commit"><div><strong>当前方案</strong><span>接管 {{ initialization.adoptItems }} · 下载 {{ initialization.downloadItems }} · 暂缓 {{ initialization.deferredItems }} · 冲突 {{ initialization.conflictItems }}。提交后应用媒体决定，下载与 Plex 入库由普通同步完成。</span></div><button class="btn btn-primary" :disabled="acting || !canCommit" @click="emit('commit')">提交接管方案</button></footer>
</template>

<style scoped>
@import '~/assets/css/components/source-initialization-summary.css';
</style>
