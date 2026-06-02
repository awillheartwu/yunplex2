<template>
  <header class="h-16 flex items-center justify-between px-8 shrink-0" style="background:var(--bg-app);border-bottom:1px solid var(--border-primary)">
    <div class="flex items-center gap-4">
      <h1 class="text-base font-semibold tracking-tight" style="color:var(--text-primary)">{{ pageTitle }}</h1>
      <StatusBadge
        v-if="syncState"
        :status="syncState.isRunning || (syncState.currentStage && syncState.currentStage !== 'idle') ? 'running' : syncState.lastSyncResult === 'success' ? 'ok' : syncState.lastSyncResult === 'failure' ? 'error' : 'idle'"
      />
    </div>
    <div class="flex items-center gap-3">
      <span v-if="syncState?.lastSyncAt" class="text-2xs text-muted">
        上次同步 {{ formatTime(syncState.lastSyncAt) }}
      </span>
      <a
        :href="githubUrl"
        target="_blank"
        class="text-2xs cursor-pointer transition-colors hover:text-[var(--text-secondary)]"
        style="color:var(--text-tertiary)"
        title="GitHub"
      >v{{ version }}</a>
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
const { state: syncState } = useSync()
const { theme, toggle: toggleTheme } = useTheme()

const version = ref('0.1.0')
const githubUrl = 'https://github.com/awillheartwu/yunplex2'

onMounted(async () => {
  try {
    const api = useApi()
    const info = await api.get<{ version: string }>('/system/info')
    version.value = info.version
  } catch { /* use default */ }
})

const titles: Record<string, string> = {
  '/': '仪表盘',
  '/sync-sources': '同步源',
  '/manual-download': '手动下载',
  '/task-center': '任务中心',
  '/config': '设置',
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
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
</script>
