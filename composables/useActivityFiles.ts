import type { ActivityRun } from '~~/shared/activity'
import type { DownloadTask } from '~~/server/lib/download/queue'
import { useLatestAsyncGuard } from './useTiming'

export function useActivityFiles(run: () => ActivityRun) {
  const api = useApi()
  const guard = useLatestAsyncGuard()
  const limit = ref(6)
  const expanded = ref<{ items: DownloadTask[]; total: number } | null>(null)
  const loading = ref(false)
  const error = ref('')
  const items = computed(() => expanded.value?.items ?? run().files?.items ?? [])
  const total = computed(() => expanded.value?.total ?? run().files?.total ?? 0)
  async function load(nextLimit = limit.value) {
    const token = guard.next()
    loading.value = true
    try {
      const result = await api.get<{ items: DownloadTask[]; total: number }>('/downloads/tasks', {
        runId: run().id, status: 'downloading,tagging,pending', limit: String(nextLimit),
      })
      if (!guard.isLatest(token)) return
      expanded.value = result
      limit.value = nextLimit
      error.value = ''
    } catch (err) {
      if (guard.isLatest(token)) error.value = err instanceof Error ? err.message : '读取歌曲失败'
    } finally {
      if (guard.isLatest(token)) loading.value = false
    }
  }
  function collapse() {
    guard.cancel()
    expanded.value = null
    limit.value = 6
    loading.value = false
    error.value = ''
  }
  watch(() => run().files, () => {
    if (!run().files?.total) collapse()
    else if (limit.value > 6) void load()
  })
  return { items, total, loading, error, limit, collapse, loadMore: () => load(limit.value + 20), retry: () => load() }
}
