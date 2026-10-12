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
      >
        <AppIcon name="music" :size="17"  />
      </div>
      <span
        v-show="!desktopCollapsed"
        class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold tracking-tight"
        :style="{ color: 'var(--text-primary)' }"
      >reYunPlex<small class="sidebar-brand__caption" :title="appConfig.revision">v{{ appConfig.version }} · {{ shortRevision }}</small></span>
    </div>

    <nav class="sidebar-nav flex-1 overflow-y-auto px-3 py-4" aria-label="主导航">
      <p v-show="!desktopCollapsed" class="sidebar-group-label">音乐工作区</p>
      <SidebarItem
        v-for="item in workspaceNavigation"
        :key="item.path"
        :icon="item.icon"
        :label="item.label"
        :path="item.path"
        :collapsed="desktopCollapsed"

        @navigate="emit('navigate')"
      />
      <NuxtLink v-if="!desktopCollapsed" to="/sync-sources?add=1" class="sidebar-add"><AppIcon name="plus" :size="16" />新建收藏</NuxtLink><div class="sidebar-nav__spacer" />
      <p v-show="!desktopCollapsed" class="sidebar-group-label">系统管理</p>
      <SidebarItem v-for="item in managementNavigation" :key="item.path" :icon="item.icon" :label="item.label" :path="item.path" :collapsed="desktopCollapsed" @navigate="emit('navigate')" />
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
import { managementNavigation, workspaceNavigation } from '~/lib/navigation'

const props = withDefaults(defineProps<{ mobile?: boolean }>(), { mobile: false })
const emit = defineEmits<{ navigate: [] }>()

const { sidebarCollapsed, loadSidebarState, toggleSidebarCollapsed } = useSidebarState()
const appConfig = useAppConfig()
const shortRevision = computed(() => appConfig.revision.slice(0, 7))
const desktopCollapsed = computed(() => sidebarCollapsed.value && !props.mobile)
const sidebarWidth = computed(() => {
  if (props.mobile) return 'min(18rem, 82vw)'
  return desktopCollapsed.value ? '64px' : '232px'
})

onMounted(loadSidebarState)

</script>

<style scoped>
.sidebar-add{display:flex;align-items:center;justify-content:center;gap:var(--space-2);margin:var(--space-6) var(--space-1) 0;min-height:2.6rem;background:var(--text-primary);color:var(--bg-app);border-radius:var(--radius-md);font-size:var(--text-sm);font-weight:var(--font-weight-semibold)}
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-block-size: var(--app-topbar-block-size);
  padding-inline: 18px;
}
.sidebar-brand__caption { display: block; margin-top: var(--space-1); font-size: var(--text-xs); color: var(--text-tertiary); font-weight: var(--font-weight-normal); }
.sidebar-group-label { margin: var(--space-3) var(--space-3) var(--space-2); font-size: var(--text-xs); letter-spacing: .1em; font-weight: var(--font-weight-semibold); color: var(--text-tertiary); }
.sidebar-nav__spacer { flex: 1; min-height: 2rem; }

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
  color: var(--on-accent);
  border: 1px solid var(--border-secondary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.app-sidebar-shell {
  position: sticky;
  top: 0;
  height: 100dvh;
  border-right: 1px solid var(--border-primary);
  box-shadow: none;
  backdrop-filter: blur(16px);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sidebar-collapse-button {
  min-height: 44px;
  padding-inline: 16px;
}

.sidebar-collapse-button.justify-center {
  padding-inline: 0;
}
</style>
