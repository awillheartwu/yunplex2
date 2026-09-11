<script setup lang="ts">
import type { SourceRequestResult } from '~~/server/lib/sync/source-requests'
import { sourceRequestReceipt } from '~/lib/source-request-presentation'
const props = defineProps<{ results: SourceRequestResult[] }>()
const rows = computed(() => props.results.map(result => ({ ...result, presentation: sourceRequestReceipt(result) })))
defineEmits<{ dismiss: [] }>()
</script>

<template>
  <section v-if="results.length" class="section-card source-request-results" role="region" aria-label="同步请求结果">
    <header>
      <div><strong>同步请求结果</strong><p>这是本次请求的受理结果，可进入来源详情查看当前进度。</p></div>
      <button class="btn btn-ghost btn-xs" aria-label="收起本次请求结果" @click="$emit('dismiss')">收起</button>
    </header>
    <ul>
      <li v-for="result in rows" :key="result.sourceId">
        <NuxtLink :to="`/sync-sources/${result.sourceId}${result.initializationId ? '?tab=initialization' : ''}`">{{ result.sourceName || result.sourceId }}</NuxtLink>
        <strong :class="`text-${result.presentation.tone}`">{{ result.presentation.label }}</strong><span class="text-muted">{{ result.message }}</span>
        <NuxtLink :to="result.presentation.href" class="btn btn-secondary btn-xs">{{ result.presentation.action }}</NuxtLink>
        <NuxtLink v-if="result.runId" :to="`/task-center/runs/${result.runId}`" class="btn btn-ghost btn-xs">查看运行</NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.source-request-results { padding: var(--space-3) var(--space-4); }
.source-request-results header { display: flex; justify-content: space-between; gap: var(--space-3); }
.source-request-results strong { font-size: var(--text-base); }
.source-request-results p { margin: var(--space-1) 0 var(--space-2_5); font-size: var(--text-xs); color: var(--text-muted); }
.source-request-results ul { display: grid; gap: var(--space-1_5); margin: 0; padding: 0; list-style: none; max-height: 20rem; overflow: auto; }
.source-request-results li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1_5) var(--space-4); font-size: var(--text-xs); overflow-wrap: anywhere; }
.source-request-results li > a:first-child { color: var(--accent); }
</style>
