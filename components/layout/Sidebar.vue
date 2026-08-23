<template>
  <aside
    data-testid="app-sidebar"
    class="app-sidebar-shell flex flex-col select-none shrink-0 transition-all duration-200 overflow-hidden"
    :style="{ background: 'var(--bg-sidebar)', width: sidebarWidth }"
  >
    <div
      data-testid="sidebar-brand"
      class="sidebar-brand shrink-0 overflow-hidden"
      :class="{ 'sidebar-brand--collapsed': desktopCollapsed }"
      style="border-bottom:1px solid var(--border-primary)"
    >
      <div
        data-testid="sidebar-logo"
        class="sidebar-logo bg-accent"
        style="box-shadow:0 16px 34px var(--accent-glow)"
      >
        <AppIcon name="music" :size="17" class="text-white" />
      </div>
      <span
        v-show="!desktopCollapsed"
        class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold tracking-tight"
        :style="{ color: 'var(--text-primary)' }"
      >YunPlex2</span>
    </div>

    <nav class="sidebar-nav flex-1 overflow-y-auto px-3 py-4">
      <SidebarItem
        v-for="item in navItems"
        :key="item.path"
        :icon="item.icon"
        :label="item.label"
        :path="item.path"
        :collapsed="desktopCollapsed"
        @navigate="emit('navigate')"
      />
    </nav>

    <div v-if="!mobile" class="shrink-0" style="border-top:1px solid var(--border-primary)">
      <button
        class="sidebar-collapse-button w-full flex items-center py-2.5 text-xs cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
        :class="desktopCollapsed ? 'justify-center' : 'gap-3'"
        :style="{ color: 'var(--text-tertiary)' }"
        :aria-label="desktopCollapsed ? '展开菜单' : '收起菜单'"
        :title="desktopCollapsed ? '展开菜单' : undefined"
        @click="toggleSidebarCollapsed"
      >
        <AppIcon name="chevronLeft" :size="14" class="transition-transform duration-200" :class="desktopCollapsed ? 'rotate-180' : ''" />
        <span
          v-show="!desktopCollapsed"
          class="whitespace-nowrap"
        >收起菜单</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useSidebarState } from '~/composables/useSidebarState'

const props = withDefaults(defineProps<{ mobile?: boolean }>(), { mobile: false })
const emit = defineEmits<{ navigate: [] }>()

const { sidebarCollapsed, loadSidebarState, toggleSidebarCollapsed } = useSidebarState()
const desktopCollapsed = computed(() => sidebarCollapsed.value && !props.mobile)
const sidebarWidth = computed(() => {
  if (props.mobile) return 'min(18rem, 82vw)'
  return desktopCollapsed.value ? '64px' : '220px'
})

onMounted(loadSidebarState)

const navItems = [
  { icon: 'dashboard', label: '仪表盘', path: '/' },
  { icon: 'source', label: '同步源', path: '/sync-sources' },
  { icon: 'download', label: '手动下载', path: '/manual-download' },
  { icon: 'activity', label: '任务中心', path: '/task-center' },
  { icon: 'settings', label: '设置', path: '/config' },
  { icon: 'info', label: '系统与运行', path: '/system' },
]
</script>

<style scoped>
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-block-size: var(--app-topbar-block-size);
  padding-inline: 18px;
}

.sidebar-brand--collapsed {
  justify-content: center;
  gap: 0;
  padding-inline: 0;
}

.sidebar-logo {
  display: flex;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: 13px;
  box-shadow: 0 10px 24px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.25) !important;
}

.app-sidebar-shell {
  position: sticky;
  top: 0;
  height: 100dvh;
  border-right: 1px solid var(--border-primary);
  box-shadow: 8px 0 28px rgba(28, 40, 68, 0.025);
  backdrop-filter: blur(22px);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.sidebar-collapse-button {
  min-height: 44px;
  padding-inline: 16px;
}

.sidebar-collapse-button.justify-center {
  padding-inline: 0;
}
</style>
