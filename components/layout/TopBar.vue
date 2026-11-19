<template>
  <header class="app-topbar sticky top-0 z-[var(--z-sticky)] flex shrink-0 items-center justify-between gap-3 px-4 sm:px-6 md:px-7 xl:px-8">
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
      <nav class="topbar-breadcrumb" aria-label="面包屑">
        <span class="hidden sm:inline">{{ context.section }}</span>
        <span class="hidden sm:inline"><AppIcon name="chevronRight" :size="13" /></span>
        <NuxtLink v-if="context.parent" :to="context.parent">{{ context.parentLabel }}</NuxtLink>
        <AppIcon v-if="context.parent" name="chevronRight" :size="13" />
        <span class="app-topbar__title truncate" aria-current="page">{{ context.title }}</span>
      </nav>
    </div>
    <div class="flex shrink-0 items-center gap-2 sm:gap-3">
      <CommandMenu />
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
import { pageContext } from '~/lib/navigation'
import { confirmUnsavedChanges } from '~/lib/unsaved-changes'
const props = withDefaults(defineProps<{
  menuOpen?: boolean
  menuMode?: 'desktop' | 'mobile'
}>(), {
  menuOpen: false,
  menuMode: 'mobile',
})
defineEmits<{ 'toggle-menu': [] }>()

const route = useRoute()
const context = computed(() => pageContext(route.path))
const { theme, toggle: toggleTheme } = useTheme()
const auth = useAuth()

const loggingOut = ref(false)
const authState = computed(() => auth.state.value)

const menuControls = computed(() => props.menuMode === 'desktop' ? 'app-sidebar' : 'mobile-navigation')
const menuButtonLabel = computed(() => {
  if (props.menuMode === 'desktop') return props.menuOpen ? '收起侧边栏' : '展开侧边栏'
  return props.menuOpen ? '关闭导航' : '打开导航'
})

onMounted(async () => {
  await auth.ensureState().catch(() => null)
})

async function handleLogout() {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    if (!await confirmUnsavedChanges()) return
    await auth.logout()
    await navigateTo('/login')
  } finally {
    loggingOut.value = false
  }
}

</script>

<style scoped>
.app-topbar {
  min-block-size: var(--app-topbar-block-size);
  padding-block: var(--space-2);
  border-bottom: 1px solid var(--border-primary);
  background: color-mix(in srgb, var(--bg-app) 92%, transparent);
  backdrop-filter: blur(16px);
}

.app-topbar__title {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0;
}
.topbar-breadcrumb { display: flex; align-items: center; gap: var(--space-2_5); min-width: 0; font-size: var(--text-xs); color: var(--text-tertiary); }
.topbar-breadcrumb a { color: var(--text-secondary); white-space: nowrap; }

@media (max-width: 767px) {
  .app-topbar__title {
    font-size: var(--text-sm);
  }
}
@media (max-width: 480px) {
  .topbar-breadcrumb > a,
  .topbar-breadcrumb > a + .app-icon { display: none; }
  .topbar-breadcrumb { overflow: hidden; }
}
</style>
