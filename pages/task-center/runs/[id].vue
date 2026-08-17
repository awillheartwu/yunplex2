<template>
  <div class="run-detail-page">
    <div v-if="loading" class="run-detail-state">正在加载运行详情…</div>
    <EmptyState v-else-if="!run" title="运行记录不存在" description="这条记录可能已被保留策略清理。">
      <NuxtLink to="/system?tab=runs" class="btn btn-secondary">返回运行记录</NuxtLink>
    </EmptyState>
    <template v-else>
      <div class="run-detail-page__title">
        <div>
          <RunTypeBadge :type="run.type" compact size="sm" />
          <h2>运行详情</h2>
        </div>
        <span v-if="run.status === 'running'" class="run-detail-page__live">
          <span />
          实时更新
        </span>
      </div>
      <JobDetail :job="run" @back="navigateTo('/system?tab=runs')" />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { TaskRun } from '~~/server/lib/job/types'
import { useIntervalFn } from '~~/composables/useTiming'

const route = useRoute()
const api = useApi()
const run = ref<TaskRun | null>(null)
const loading = ref(true)

async function fetchRun() {
  try {
    run.value = await api.get<TaskRun>(`/runs/${String(route.params.id)}`)
  } catch {
    run.value = null
  } finally {
    loading.value = false
  }
}

const polling = useIntervalFn(() => {
  if (run.value?.status === 'running') void fetchRun()
}, 2500)

onMounted(async () => {
  await fetchRun()
  polling.start()
})
onUnmounted(() => polling.stop())
</script>

<style scoped>
.run-detail-page{display:flex;flex-direction:column;gap:1.25rem;padding-bottom:2rem}
.run-detail-page__title{display:flex;align-items:center;justify-content:space-between}
.run-detail-page__title>div{display:flex;align-items:center;gap:.65rem}
.run-detail-page__title h2{margin:0;color:var(--text-primary);font-size:1.05rem}
.run-detail-page__live{display:flex;align-items:center;gap:.45rem;color:var(--accent);font-size:.75rem;font-weight:700}
.run-detail-page__live span{width:.5rem;height:.5rem;border-radius:999px;background:var(--success);box-shadow:0 0 0 5px var(--success-soft)}
.run-detail-state{display:flex;min-height:18rem;align-items:center;justify-content:center;color:var(--text-secondary)}
</style>
