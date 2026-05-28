<template>
  <div class="space-y-8">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-sm font-semibold">同步日志</h2>
        <p class="text-2xs text-muted mt-0.5">超过保留天数的日志自动清理，5,000 行硬上限兜底</p>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center rounded-lg border border-[var(--border-secondary)] overflow-hidden">
          <button
            v-for="f in filters"
            :key="f.value"
            class="px-3 py-1.5 text-sm transition-colors"
            :class="activeFilter === f.value
              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
              : 'text-muted hover:text-[var(--text-primary)]'"
            @click="setFilter(f.value)"
          >
            {{ f.label }}
          </button>
        </div>
        <button class="btn btn-danger btn-sm" @click="showClearConfirm = true">清空日志</button>
      </div>
    </div>

    <!-- Count bar -->
    <div v-if="loading" class="flex items-center justify-center py-16">
      <span class="text-sm text-muted">加载中...</span>
    </div>
    <template v-else-if="logs.length > 0">
    <div class="flex items-center justify-between text-2xs text-muted-deep mb-1">
      <span>共 {{ total }} 条记录</span>
    </div>

    <div class="section-card overflow-hidden font-mono text-sm">
      <div class="overflow-x-auto">
        <div
          v-for="log in logs"
          :key="log.id"
          class="px-4 py-1.5 flex gap-4 hover:bg-[var(--bg-hover)] border-b border-[var(--border-primary)] last:border-0"
        >
          <span class="text-2xs text-muted-deep shrink-0 whitespace-nowrap">{{ formatTime(log.timestamp) }}</span>
          <span class="shrink-0 w-10" :class="logLevelColor(log.level)">{{ log.level.toUpperCase() }}</span>
          <span v-if="log.stage && log.stage !== 'idle'" class="text-muted-deep shrink-0">[{{ log.stage }}]</span>
          <span class="text-muted flex-1">{{ log.message }}</span>
        </div>
      </div>
    </div>
    </template>

    <EmptyState v-else-if="!loading" title="暂无日志" :description="activeFilter ? '当前筛选条件下没有匹配的日志' : '执行同步任务后日志将出现在这里'" />

    <Pagination
      :has-more="hasMore"
      :loading="loadingMore"
      :current-count="logs.length"
      :total="total"
      @load-more="loadMore"
    />

    <ConfirmDialog
      :visible="showClearConfirm"
      title="清空日志"
      message="确定要清空所有同步日志吗？此操作不可撤销。"
      confirm-label="清空"
      variant="danger"
      @confirm="handleClear"
      @cancel="showClearConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import type { LogEntry, LogLevel } from '~~/server/lib/log/types'

const api = useApi()
const logs = ref<LogEntry[]>([])
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const activeFilter = ref<LogLevel | ''>('')
const showClearConfirm = ref(false)
const PAGE_SIZE = 50
const offset = ref(0)

const hasMore = computed(() => logs.value.length < total.value)

const filters = [
  { label: '全部', value: '' },
  { label: '信息', value: 'info' },
  { label: '警告', value: 'warn' },
  { label: '错误', value: 'error' },
]

async function fetchLogs() {
  loading.value = true
  offset.value = 0
  try {
    const params: Record<string, string> = { limit: String(PAGE_SIZE) }
    if (activeFilter.value) params.level = activeFilter.value
    const res = await api.get<{ items: LogEntry[]; total: number }>('/logs', params)
    logs.value = res.items
    total.value = res.total
  } catch { /* ignore */ } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const newOffset = offset.value + PAGE_SIZE
    const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(newOffset) }
    if (activeFilter.value) params.level = activeFilter.value
    const res = await api.get<{ items: LogEntry[]; total: number }>('/logs', params)
    logs.value = [...logs.value, ...res.items]
    total.value = res.total
    offset.value = newOffset
  } catch { /* ignore */ } finally {
    loadingMore.value = false
  }
}

function setFilter(level: LogLevel | '') {
  activeFilter.value = level
  fetchLogs()
}

async function handleClear() {
  showClearConfirm.value = false
  try {
    await api.del('/logs')
    logs.value = []
    total.value = 0
  } catch { /* ignore */ }
}

function logLevelColor(level: string): string {
  switch (level) {
    case 'error': return 'text-danger'
    case 'warn': return 'text-warning'
    default: return 'text-muted-deep'
  }
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${dd} ${h}:${mi}:${ss}`
}

let sse: EventSource | null = null

onMounted(() => {
  fetchLogs()
  try {
    sse = new EventSource('/api/sync/events')
    sse.addEventListener('log', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      // Only prepend if matching current filter
      if (!activeFilter.value || data.level === activeFilter.value) {
        logs.value = [data as LogEntry, ...logs.value]
        total.value++
      }
    })
  } catch { /* SSE unsupported */ }
})

onUnmounted(() => {
  if (sse) { sse.close(); sse = null }
})
</script>
