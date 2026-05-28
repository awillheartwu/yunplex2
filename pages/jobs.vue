<template>
  <div class="space-y-8">
    <!-- Job detail view -->
    <template v-if="selectedJob">
      <JobDetail :job="selectedJob" @back="backToList" />
    </template>

    <template v-else>
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-sm font-semibold">同步历史</h2>
        <p class="text-2xs text-muted mt-0.5">查看历次同步任务的执行结果和详情</p>
      </div>
      <div class="flex items-center gap-4">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索..."
          class="form-input w-48 text-sm"
          @input="onSearchInput"
        />
        <DateRange v-model="dateFilter" :min-date="earliestDate" />
        <button class="btn btn-danger btn-sm" @click="showClear = true">清空</button>
        <button class="btn btn-secondary btn-sm" @click="fetchJobs">刷新</button>
      </div>
    </div>

    <!-- Filter tabs -->
    <div class="flex items-center gap-1">
      <button
        v-for="f in filters"
        :key="f.value"
        class="px-3 py-1.5 text-sm rounded-lg transition-colors"
        :class="activeFilter === f.value
          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium'
          : 'text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'"
        @click="setFilter(f.value)"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Job list -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <span class="text-muted text-sm">加载中...</span>
      </div>

      <div v-else-if="jobs.length === 0" class="flex flex-col items-center justify-center py-16">
        <div class="w-12 h-12 rounded-full bg-[var(--bg-surface)] flex items-center justify-center mb-4">
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2.5" width="12" height="2.2" rx="1" stroke="#6b6b6b" stroke-width="1.3" />
            <rect x="2" y="6.9" width="9" height="2.2" rx="1" stroke="#6b6b6b" stroke-width="1.3" />
            <rect x="2" y="11.3" width="7" height="2.2" rx="1" stroke="#6b6b6b" stroke-width="1.3" />
          </svg>
        </div>
        <p class="text-sm font-medium text-muted">暂无同步记录</p>
        <p class="text-2xs text-muted-deep mt-1">{{ hasActiveFilter ? '当前筛选条件下没有匹配的任务' : '执行同步后，任务记录将显示在这里' }}</p>
      </div>

      <div v-else class="space-y-3">
        <div class="flex items-center justify-between text-2xs text-muted-deep mb-1">
          <span>共 {{ total }} 条记录</span>
        </div>
        <JobCard
          v-for="job in jobs"
          :key="job.id"
          :job="job"
          @select="selectJob(job.id)"
        />
        <Pagination
          :has-more="hasMore"
          :loading="loadingMore"
          :current-count="jobs.length"
          :total="total"
          @load-more="loadMore"
        />
      </div>
    </template>

    <!-- Clear confirm -->
    <ConfirmDialog
      :visible="showClear"
      title="清空任务记录"
      message="确定要清空所有同步任务记录吗？"
      confirm-label="清空"
      variant="danger"
      @confirm="handleClear"
      @cancel="showClear = false"
    />
  </div>
</template>

<script setup lang="ts">
import type { SyncJob, JobStatus } from '~~/server/lib/job/types'

const api = useApi()
const { jobs, total, loading, loadingMore, hasMore, activeFilter, searchQuery, dateFilter, earliestDate, fetchJobs, loadMore, setFilter } = useJobs()
const selectedJob = ref<SyncJob | null>(null)
const showClear = ref(false)
const router = useRouter()
const route = useRoute()

const hasActiveFilter = computed(() => !!activeFilter.value || !!searchQuery.value || !!dateFilter.value.from || !!dateFilter.value.to)

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => fetchJobs(), 300)
}

const filters: { label: string; value: JobStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: '成功', value: 'success' },
  { label: '部分失败', value: 'partial' },
  { label: '失败', value: 'failed' },
]

async function selectJob(id: string) {
  try {
    selectedJob.value = await api.get<SyncJob>(`/jobs/${id}`)
    router.push({ query: { id } })
  } catch {
    // keep showing list
  }
}

function backToList() {
  selectedJob.value = null
  router.push({ query: {} })
}

watch(() => route.query.id, (newId) => {
  if (!newId) {
    selectedJob.value = null
  } else if (typeof newId === 'string' && (!selectedJob.value || selectedJob.value.id !== newId)) {
    selectJob(newId)
  }
})

async function handleClear() {
  showClear.value = false
  try {
    await api.del('/jobs')
    await fetchJobs()
  } catch { /* ignore */ }
}

watch(dateFilter, () => fetchJobs(), { deep: true })

onMounted(async () => {
  await fetchJobs()
  const route = useRoute()
  const jobId = route.query.id as string | undefined
  if (jobId) await selectJob(jobId)
})
</script>
