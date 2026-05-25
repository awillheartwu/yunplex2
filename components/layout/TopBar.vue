<template>
  <header class="h-16 flex items-center justify-between px-8 shrink-0" style="background:var(--bg-app);border-bottom:1px solid var(--border-primary)">
    <div class="flex items-center gap-4">
      <h1 class="text-base font-semibold tracking-tight" style="color:var(--text-primary)">{{ pageTitle }}</h1>
      <StatusBadge
        v-if="syncState"
        :status="syncState.isRunning ? 'running' : syncState.lastSyncResult === 'success' ? 'ok' : syncState.lastSyncResult === 'failure' ? 'error' : 'idle'"
      />
    </div>
    <div class="flex items-center gap-3">
      <span class="text-2xs text-muted">
        {{ syncState?.lastSyncAt ? `上次同步 ${formatTime(syncState.lastSyncAt)}` : '尚未同步' }}
      </span>
      <button
        class="text-xs cursor-pointer px-1.5 py-0.5 rounded transition-colors duration-150"
        :class="theme === 'dark' ? 'text-warning hover:bg-[var(--bg-hover)]' : 'text-muted hover:bg-[var(--bg-hover)]'"
        :title="theme === 'dark' ? '浅色主题' : '深色主题'"
        @click="toggleTheme"
      >
        {{ theme === 'dark' ? '☀' : '☾' }}
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
const route = useRoute()
const { state: syncState, startPolling, stopPolling } = useSync()
const { theme, toggle: toggleTheme } = useTheme()

const titles: Record<string, string> = {
  '/': '仪表盘',
  '/config': '设置',
  '/logs': '日志',
  '/task': '下载状态',
  '/system': '系统',
  '/jobs': '同步历史',
}

const pageTitle = computed(() => titles[route.path] || 'YunPlex2')

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

onMounted(() => startPolling(15000))
onUnmounted(() => stopPolling())
</script>
