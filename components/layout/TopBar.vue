<template>
  <header class="app-topbar sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 px-4 sm:px-6 md:px-8 xl:px-9">
    <div class="flex min-w-0 items-center gap-3 sm:gap-4">
      <button
        class="icon-button"
        type="button"
        :aria-label="menuButtonLabel"
        :aria-expanded="menuOpen"
        :aria-controls="menuControls"
        :title="menuButtonLabel"
        @click="$emit('toggle-menu')"
      >
        <AppIcon name="menu" :size="18" />
      </button>
      <h1 class="app-topbar__title truncate">{{ pageTitle }}</h1>
      <StatusBadge
        v-if="syncState"
        class="hidden sm:inline-flex"
        :status="syncState.isRunning || (syncState.currentStage && syncState.currentStage !== 'idle') ? 'running' : syncState.lastSyncResult === 'success' ? 'ok' : syncState.lastSyncResult === 'failure' ? 'error' : 'idle'"
      />
    </div>
    <div class="flex shrink-0 items-center gap-2 sm:gap-3">
      <span v-if="syncState?.lastSyncAt" class="hidden text-2xs text-muted lg:inline">
        上次同步 {{ formatTime(syncState.lastSyncAt) }}
      </span>
      <a
        :href="githubUrl"
        target="_blank"
        class="topbar-version-link hidden sm:inline-flex text-2xs cursor-pointer transition-colors hover:text-[var(--text-secondary)]"
        style="color:var(--text-tertiary)"
        title="GitHub"
      >v{{ version }}</a>
      <button
        class="icon-button"
        :class="theme === 'dark' ? 'text-warning hover:bg-[var(--bg-hover)]' : 'text-muted hover:bg-[var(--bg-hover)]'"
        :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
        :title="theme === 'dark' ? '浅色主题' : '深色主题'"
        @click="toggleTheme"
      >
        <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="17" />
      </button>
      <button
        v-if="authState?.authEnabled && authState.authenticated"
        class="icon-button"
        type="button"
        aria-label="退出登录"
        title="退出登录"
        :disabled="loggingOut"
        @click="handleLogout"
      >
        <AppIcon :name="loggingOut ? 'loader' : 'logOut'" :class="loggingOut ? 'animate-spin' : ''" :size="17" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  menuOpen?: boolean
  menuMode?: 'desktop' | 'mobile'
}>(), {
  menuOpen: false,
  menuMode: 'mobile',
})
defineEmits<{ 'toggle-menu': [] }>()

const route = useRoute()
const { state: syncState } = useSync()
const { theme, toggle: toggleTheme } = useTheme()
const auth = useAuth()

const version = ref('0.1.0')
const loggingOut = ref(false)
const githubUrl = 'https://github.com/awillheartwu/yunplex2'
const authState = computed(() => auth.state.value)

const menuControls = computed(() => props.menuMode === 'desktop' ? 'app-sidebar' : 'mobile-navigation')
const menuButtonLabel = computed(() => {
  if (props.menuMode === 'desktop') return props.menuOpen ? '收起侧边栏' : '展开侧边栏'
  return props.menuOpen ? '关闭导航' : '打开导航'
})

onMounted(async () => {
  await auth.ensureState().catch(() => null)
  try {
    const api = useApi()
    const info = await api.get<{ version: string }>('/system/info')
    version.value = info.version
  } catch { /* use default */ }
})

async function handleLogout() {
  loggingOut.value = true
  try {
    await auth.logout()
    await navigateTo('/login')
  } finally {
    loggingOut.value = false
  }
}

const titles: Record<string, string> = {
  '/': '仪表盘',
  '/activity': '动态',
  '/sync-sources': '同步源',
  '/match-reviews': '匹配管理',
  '/manual-download': '手动下载',
  '/task-center': '任务中心',
  '/config': '设置',
  '/system': '系统',
}

const pageTitle = computed(() => {
  if (route.path.startsWith('/task-center/runs/')) return '运行详情'
  return titles[route.path] || 'YunPlex2'
})

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

<style scoped>
.app-topbar {
  min-block-size: var(--app-topbar-block-size);
  padding-block: 0.55rem;
  border-bottom: 1px solid var(--border-primary);
  background: color-mix(in srgb, var(--bg-app) 88%, transparent);
  backdrop-filter: blur(20px) saturate(1.15);
}

.app-topbar__title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 1.55rem;
  font-weight: 750;
  letter-spacing: 0;
}

.topbar-version-link {
  min-block-size: 2.5rem;
  align-items: center;
}

@media (max-width: 767px) {
  .app-topbar__title {
    font-size: 1.35rem;
  }
}
</style>
