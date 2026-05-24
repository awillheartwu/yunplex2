<template>
  <aside class="w-[280px] flex flex-col select-none" style="background:var(--bg-sidebar);border-right:1px solid var(--border-primary)">
    <!-- Logo -->
    <div class="h-16 flex items-center gap-3 px-5 shrink-0" style="border-bottom:1px solid var(--border-primary)">
      <div class="w-8 h-8 rounded-md bg-accent flex items-center justify-center">
        <svg width="17" height="17" viewBox="0 0 32 32" fill="none">
          <path d="M8 10h6l4 6-4 6H8l4-6-4-6z" fill="#fff" opacity="0.9" />
          <path d="M18 10h6l-4 6 4 6h-6l-4-6 4-6z" fill="#fff" opacity="0.6" />
        </svg>
      </div>
      <span class="text-base font-semibold tracking-tight">YunPlex2</span>
    </div>

    <!-- Nav -->
    <nav class="flex-1 px-3 py-4 space-y-0.5">
      <SidebarItem
        v-for="item in navItems"
        :key="item.path"
        :icon="item.icon"
        :label="item.label"
        :path="item.path"
      />
    </nav>

    <!-- Footer -->
    <div class="px-3 py-3 text-2xs text-muted-deep" style="border-top:1px solid var(--border-primary)">
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
