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
            @click="activeFilter = f.value"
          >
            {{ f.label }}
          </button>
        </div>
        <button class="btn btn-danger btn-sm" @click="showClearConfirm = true">
          清空日志
        </button>
      </div>
    </div>

    <div v-if="filteredLogs.length > 0" class="bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl overflow-hidden font-mono text-sm">
      <div class="overflow-x-auto">
        <div
          v-for="log in filteredLogs"
          :key="log.id"
          class="px-4 py-1.5 flex gap-4 hover:bg-[var(--bg-hover)] border-b border-[var(--border-primary)] last:border-0"
        >
          <span class="text-2xs text-muted-deep shrink-0 w-20">{{ formatTime(log.timestamp) }}</span>
          <span class="shrink-0 w-10" :class="logLevelColor(log.level)">{{ log.level.toUpperCase() }}</span>
          <span v-if="log.stage && log.stage !== 'idle'" class="text-muted-deep shrink-0">[{{ log.stage }}]</span>
          <span class="text-muted flex-1">{{ log.message }}</span>
        </div>
      </div>
    </div>

    <EmptyState v-else title="暂无日志" :description="activeFilter ? '当前筛选条件下没有匹配的日志' : '执行同步任务后日志将出现在这里'" />

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
const activeFilter = ref<LogLevel | ''>('')
const showClearConfirm = ref(false)

const filters = [
  { label: '全部', value: '' },
  { label: '信息', value: 'info' },
  { label: '警告', value: 'warn' },
  { label: '错误', value: 'error' },
]

const filteredLogs = computed(() => {
  if (!activeFilter.value) return logs.value
  return logs.value.filter(l => l.level === activeFilter.value)
})

async function fetchLogs() {
  try {
    logs.value = await api.get<LogEntry[]>('/logs', { limit: '200' })
  } catch { /* ignore */ }
}

async function handleClear() {
  showClearConfirm.value = false
  try {
    await api.del('/logs')
    logs.value = []
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
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

onMounted(fetchLogs)
</script>
