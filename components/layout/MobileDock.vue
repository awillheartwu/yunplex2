<template>
  <nav class="mobile-dock" aria-label="快捷导航"><NuxtLink v-for="item in workspaceNavigation" :key="item.path" :to="item.path" :aria-current="active(item.path) ? 'page' : undefined"><AppIcon :name="item.icon" :size="21" /><span>{{ item.label }}</span></NuxtLink></nav>
</template>
<script setup lang="ts">
import { workspaceNavigation } from '~/lib/navigation'
const route = useRoute()
const active = (path: string) => path === '/' ? route.path === '/' : route.path === path || route.path.startsWith(`${path}/`)
</script>
<style scoped>
.mobile-dock {
  display: none;
}
@media (max-width: 767px) {
  .mobile-dock {
    position: fixed;
    z-index: var(--z-dock);
    bottom: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    height: var(--mobile-dock-space);
    padding: var(--space-2) var(--space-2)
      calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--border-primary);
    background: var(--bg-sidebar);
  }
  .mobile-dock a {
    display: grid;
    justify-items: center;
    gap: var(--space-1);
    padding: var(--space-1_5);
    border-radius: var(--radius-md);
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    min-height: var(--control-height-touch);
  }
  .mobile-dock a[aria-current] {
    color: var(--accent);
    background: var(--accent-muted);
  }
}
</style>
