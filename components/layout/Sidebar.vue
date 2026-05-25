<template>
  <aside class="w-[250px] flex flex-col select-none shrink-0" style="background:var(--bg-sidebar)">
    <!-- Logo -->
    <div class="h-16 flex items-center gap-3 px-5 shrink-0" style="border-bottom:1px solid var(--border-primary)">
      <div class="w-7 h-7 rounded-md bg-accent flex items-center justify-center shadow-sm">
        <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
          <path d="M8 10h6l4 6-4 6H8l4-6-4-6z" fill="#fff" opacity="0.9" />
          <path d="M18 10h6l-4 6 4 6h-6l-4-6 4-6z" fill="#fff" opacity="0.6" />
        </svg>
      </div>
      <span class="text-sm font-semibold tracking-tight" style="color:var(--text-primary)">YunPlex2</span>
    </div>

    <!-- Nav groups -->
    <nav class="flex-1 overflow-y-auto px-3 py-2 space-y-3">
      <SidebarGroup
        v-for="group in navGroups"
        :key="group.key"
        :label="group.label"
        :default-open="group.defaultOpen"
      >
        <SidebarItem
          v-for="item in group.items"
          :key="item.path"
          :icon="item.icon"
          :label="item.label"
          :path="item.path"
        />
      </SidebarGroup>
    </nav>

    <!-- Footer -->
    <div class="px-3 py-2 text-2xs" style="color:var(--text-tertiary);border-top:1px solid var(--border-primary)">
      v0.1.0
    </div>
  </aside>
</template>

<script setup lang="ts">
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
      { icon: 'list', label: '同步历史', path: '/jobs' },
      { icon: 'download', label: '下载状态', path: '/task' },
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
