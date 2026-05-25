<template>
  <aside class="w-[220px] flex flex-col select-none shrink-0" style="background:var(--bg-sidebar)">
    <!-- Logo -->
    <div class="h-14 flex items-center gap-2.5 px-4 shrink-0" style="border-bottom:1px solid var(--border-primary)">
      <div class="w-7 h-7 rounded-md bg-accent flex items-center justify-center shadow-sm">
        <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
          <path d="M8 10h6l4 6-4 6H8l4-6-4-6z" fill="#fff" opacity="0.9" />
          <path d="M18 10h6l-4 6 4 6h-6l-4-6 4-6z" fill="#fff" opacity="0.6" />
        </svg>
      </div>
      <span class="text-sm font-semibold tracking-tight" style="color:var(--text-primary)">YunPlex2</span>
    </div>

    <!-- Nav -->
    <nav class="flex-1 px-2.5 py-2 space-y-px">
      <SidebarItem
        v-for="item in navItems"
        :key="item.path"
        :icon="item.icon"
        :label="item.label"
        :path="item.path"
      />
    </nav>

    <!-- Footer -->
    <div class="px-3 py-2 text-2xs" style="color:var(--text-tertiary);border-top:1px solid var(--border-primary)">
      v0.1.0
    </div>
  </aside>
</template>

<script setup lang="ts">
const navItems = [
  { icon: 'dashboard', label: '仪表盘', path: '/' },
  { icon: 'settings', label: '配置', path: '/config' },
  { icon: 'list', label: '任务中心', path: '/jobs' },
  { icon: 'activity', label: '任务状态', path: '/task' },
  { icon: 'logs', label: '日志', path: '/logs' },
  { icon: 'info', label: '系统', path: '/system' },
]
</script>
