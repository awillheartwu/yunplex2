import type { JobSummary, JobStatus } from '~~/server/lib/job/types'

interface JobListResponse {
  items: JobSummary[]
  total: number
}

const PAGE_SIZE = 20

export function useJobs() {
  const api = useApi()
  const jobs = ref<JobSummary[]>([])
  const total = ref(0)
  const loading = ref(false)
  const loadingMore = ref(false)
  const activeFilter = ref<JobStatus | ''>('')
  const searchQuery = ref('')
  const offset = ref(0)

  const hasMore = computed(() => jobs.value.length < total.value)
  const filteredJobs = computed(() => {
    let list = jobs.value
    if (activeFilter.value) {
      list = list.filter((j) => j.status === activeFilter.value)
    }
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter((j) => j.summary.toLowerCase().includes(q) || j.id.includes(q))
    }
    return list
  })

  async function fetchJobs() {
    loading.value = true
    offset.value = 0
    try {
      const params: Record<string, string> = { limit: String(PAGE_SIZE) }
      if (activeFilter.value) params.status = activeFilter.value
      if (searchQuery.value) params.search = searchQuery.value
      const res = await api.get<JobListResponse>('/jobs', params)
      jobs.value = res.items
      total.value = res.total
    } catch {
      jobs.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const newOffset = offset.value + PAGE_SIZE
      const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(newOffset) }
      if (activeFilter.value) params.status = activeFilter.value
      if (searchQuery.value) params.search = searchQuery.value
      const res = await api.get<JobListResponse>('/jobs', params)
      jobs.value = [...jobs.value, ...res.items]
      total.value = res.total
      offset.value = newOffset
    } catch { /* ignore */ } finally {
      loadingMore.value = false
    }
  }

  function setFilter(status: JobStatus | '') {
    activeFilter.value = status
    fetchJobs()
  }

  return {
    jobs: filteredJobs,
    total,
    loading,
    loadingMore,
    hasMore,
    activeFilter,
    searchQuery,
    fetchJobs,
    loadMore,
    setFilter,
  }
}
