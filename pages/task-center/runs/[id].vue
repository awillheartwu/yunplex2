<template>
  <div class="run-detail-page">
    <div v-if="loading" class="run-detail-state">正在加载运行详情…</div>
    <div v-if="runError" class="section-card run-detail-error" role="alert"><strong>暂时无法读取运行记录</strong><p>{{ runError }}</p><button class="btn btn-secondary btn-sm" @click="fetchRun">重新加载</button></div>
    <EmptyState v-if="!loading && !run && !runError" title="运行记录不存在" description="这条记录可能已被保留策略清理。">
      <NuxtLink to="/task-center?tab=runs" class="btn btn-secondary">返回运行记录</NuxtLink>
    </EmptyState>
    <template v-if="run">
      <div class="run-detail-page__title">
        <div>
          <RunTypeBadge :type="run.type" compact size="sm" />
          <h1>运行详情</h1>
        </div>
        <span v-if="run.status === 'running'" class="run-detail-page__live">
          <span />
          实时更新
        </span>
        <button
          v-if="run.type === 'source_initialization' && run.status === 'running' && run.sourceIds?.[0]"
          class="btn btn-secondary btn-sm"
          @click="cancelInitialization(run.sourceIds[0])"
        >
          取消分析
        </button>
        <NuxtLink
          v-else-if="run.type === 'source_initialization' && run.status === 'awaiting_action' && run.sourceIds?.[0]"
          class="btn btn-primary btn-sm"
          :to="`/sync-sources/${run.sourceIds[0]}?tab=initialization`"
        >
          打开接管工作台
        </NuxtLink>
        <button
          v-else-if="run.type === 'source_initialization' && run.status === 'failed' && run.sourceIds?.[0]"
          class="btn btn-primary btn-sm"
          @click="retryInitialization(run.sourceIds[0])"
        >
          重试分析
        </button>
      </div>
      <JobDetail :job="run" @back="navigateTo('/task-center?tab=runs')" />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { TaskRun } from '~~/server/lib/job/types'
import { useIntervalFn, useLatestAsyncGuard } from '~~/composables/useTiming'
import { sseSubscribe } from '~~/composables/sse'

const route = useRoute()
const api = useApi()
const run = ref<TaskRun | null>(null)
const loading = ref(true)
const runError = ref('')
const fetchGuard = useLatestAsyncGuard()

async function fetchRun() {
  const token = fetchGuard.next()
  try {
    const result = await api.get<TaskRun>(`/runs/${String(route.params.id)}`)
    if (!fetchGuard.isLatest(token)) return
    run.value = result
    runError.value = ''
  } catch (error) {
    if (fetchGuard.isLatest(token)) runError.value = error instanceof Error ? error.message : '请稍后重试'
  } finally {
    if (fetchGuard.isLatest(token)) loading.value = false
  }
}

async function cancelInitialization(sourceId: string) {
  await api.post(`/playlist-sources/${sourceId}/initialization/cancel`, {})
  await fetchRun()
}

async function retryInitialization(sourceId: string) {
  await api.post(`/playlist-sources/${sourceId}/initialization/start`, {})
  await navigateTo(`/sync-sources/${sourceId}?tab=initialization`)
}

const polling = useIntervalFn(() => {
  if (run.value?.status === 'running' || run.value?.status === 'awaiting_action' || runError.value) void fetchRun()
}, 2500)

onMounted(async () => {
  resumeUnsubscribe = sseSubscribe('resync', () => { void fetchRun() })
  polling.start()
  await fetchRun()
})
let resumeUnsubscribe: (() => void) | null = null
onUnmounted(() => { polling.stop(); resumeUnsubscribe?.() })
</script>

<style scoped>
.run-detail-error { display: grid; justify-items: start; gap: var(--space-2); padding: var(--space-4); color: var(--danger); }
.run-detail-page{display:flex;flex-direction:column;gap:var(--space-5);padding-bottom:var(--space-8)}
.run-detail-page__title{display:flex;align-items:center;justify-content:space-between}
.run-detail-page__title>div{display:flex;align-items:center;gap:var(--space-2_5)}
.run-detail-page__title h1{margin:0;color:var(--text-primary)}
.run-detail-page__live{display:flex;align-items:center;gap:var(--space-2);color:var(--accent);font-size:var(--text-xs);font-weight:var(--font-weight-bold)}
.run-detail-page__live span{width:.5rem;height:.5rem;border-radius:var(--radius-full);background:var(--success);box-shadow:0 0 0 5px var(--success-soft)}
.run-detail-state{display:flex;min-height:18rem;align-items:center;justify-content:center;color:var(--text-secondary)}
</style>
