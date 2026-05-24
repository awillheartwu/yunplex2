<template>
  <header class="h-16 flex items-center justify-between px-8 shrink-0" style="background:var(--bg-app);border-bottom:1px solid var(--border-primary)">
    <div class="flex items-center gap-3">
      <h1 class="text-base font-medium" style="color:var(--text-primary)">{{ pageTitle }}</h1>
      <StatusBadge
        v-if="syncState"
        :status="syncState.isRunning ? 'running' : syncState.lastSyncResult === 'success' ? 'ok' : syncState.lastSyncResult === 'failure' ? 'error' : 'idle'"
      />
    </div>
    <div class="flex items-center gap-3">
      <span class="text-2xs text-muted-deep">
        {{ syncState?.lastSyncAt ? `上次同步: ${formatTime(syncState.lastSyncAt)}` : '尚未同步' }}
      </span>
      <button
        class="text-2xs cursor-pointer px-2 py-1 rounded transition-colors"
        :class="theme === 'dark' ? 'text-warning hover:bg-[#f1c40f10]' : 'text-muted hover:bg-[#6b6b6b10]'"
        :title="theme === 'dark' ? '切换浅色主题' : '切换深色主题'"
        @click="toggleTheme"
      >
        {{ theme === 'dark' ? '☀' : '☾' }}
      </button>
      <div class="w-px h-4" style="background:var(--border-primary)" />
      <span class="text-2xs text-muted-deep font-mono">YunPlex2 v0.1.0</span>
    </div>
  </header>
</template>

<script setup lang="ts">
const route = useRoute()
const { state: syncState, startPolling, stopPolling } = useSync()
const { theme, toggle: toggleTheme } = useTheme()

const titles: Record<string, string> = {
  '/': '仪表盘',
  '/config': '配置',
  '/logs': '同步日志',
  '/task': '任务状态',
  '/system': '系统',
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
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => startPolling(15000))
onUnmounted(() => stopPolling())
</script>
