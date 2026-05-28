<template>
  <aside
    class="flex flex-col select-none shrink-0 transition-all duration-200 overflow-hidden"
    :style="{ background: 'var(--bg-sidebar)', width: collapsed ? '56px' : '250px' }"
  >
    <!-- Logo -->
    <div class="h-16 flex items-center gap-3 px-4 shrink-0 overflow-hidden" style="border-bottom:1px solid var(--border-primary)">
      <div class="w-7 h-7 rounded-md bg-accent flex items-center justify-center shadow-sm shrink-0">
        <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
          <path d="M8 10h6l4 6-4 6H8l4-6-4-6z" fill="#fff" opacity="0.9" />
          <path d="M18 10h6l-4 6 4 6h-6l-4-6 4-6z" fill="#fff" opacity="0.6" />
        </svg>
      </div>
      <span
        class="text-sm font-semibold tracking-tight whitespace-nowrap transition-opacity duration-200"
        :style="{ color: 'var(--text-primary)', opacity: collapsed ? 0 : 1 }"
      >YunPlex2</span>
    </div>

    <!-- Nav groups -->
    <nav class="flex-1 overflow-y-auto px-3 py-2 space-y-3">
      <SidebarGroup
        v-for="group in navGroups"
        :key="group.key"
        :label="group.label"
        :default-open="group.defaultOpen"
        :collapsed="collapsed"
      >
        <SidebarItem
          v-for="item in group.items"
          :key="item.path"
          :icon="item.icon"
          :label="item.label"
          :path="item.path"
          :collapsed="collapsed"
        />
      </SidebarGroup>
    </nav>

    <!-- Toggle + Footer -->
    <div class="shrink-0" style="border-top:1px solid var(--border-primary)">
      <button
        class="w-full flex items-center gap-3 px-4 py-2.5 text-xs cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
        :style="{ color: 'var(--text-tertiary)' }"
        @click="collapsed = !collapsed; saveState()"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="shrink-0 transition-transform duration-200" :class="collapsed ? 'rotate-180' : ''">
          <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span
          class="whitespace-nowrap transition-opacity duration-200"
          :style="{ opacity: collapsed ? 0 : 1 }"
        >收起菜单</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
const STORAGE_KEY = 'yunplex-sidebar-collapsed'

const collapsed = ref(false)

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, String(collapsed.value)) } catch { /* ignore */ }
}

onMounted(() => {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'true') collapsed.value = true
  } catch { /* ignore */ }
})

const navGroups = [
  {
    key: 'overview', label: '总览', defaultOpen: true,
    items: [
      { icon: 'dashboard', label: '仪表盘', path: '/' },
      { icon: 'logs', label: '日志', path: '/logs' },
    ],
  },
  {
    key: 'tasks', label: '任务中心', defaultOpen: true,
    items: [
      { icon: 'source', label: '歌单源', path: '/sources' },
      { icon: 'download', label: '下载中心', path: '/downloads' },
      { icon: 'list', label: '同步历史', path: '/jobs' },
    ],
  },
  {
    key: 'settings', label: '设置', defaultOpen: true,
    items: [
      { icon: 'info', label: '系统', path: '/system' },
      { icon: 'settings', label: '设置', path: '/config' },
    ],
  },
]
</script>
