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
  <footer class="source-adoption__commit"><div><strong>提交前最终确认</strong><span>接管 {{ initialization.adoptItems }} · 下载 {{ initialization.downloadItems }} · 暂缓 {{ initialization.deferredItems }} · 冲突 {{ initialization.conflictItems }}</span><small>普通同步队列 {{ queueDepth }} 项 · 下载并发 {{ downloadConcurrency }}</small></div><button class="btn btn-primary" :disabled="acting || !canCommit" @click="emit('commit')">提交接管方案</button></footer>
</template>

<style scoped>
@import '~/assets/css/components/source-initialization-summary.css';
</style>
