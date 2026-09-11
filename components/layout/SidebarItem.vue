<template>
  <NuxtLink
    :to="path"
    :title="collapsed ? label : undefined"
    :aria-label="label"
    :aria-current="isActive ? 'page' : undefined"
    class="sidebar-item"
    :class="[
      collapsed ? 'sidebar-item--collapsed' : '',
      isActive
        ? 'sidebar-item--active'
        : ''
    ]"
    @click="$emit('navigate')"
  >
    <SidebarIcon :name="icon" :active="isActive" />
    <span v-show="!collapsed" class="sidebar-item__label">{{ label }}<small v-if="description">{{ description }}</small></span>
  </NuxtLink>
</template>

<script setup lang="ts">
const props = defineProps<{
  icon: string
  label: string
  path: string
  collapsed?: boolean
  description?: string
}>()
defineEmits<{ navigate: [] }>()

const route = useRoute()
const isActive = computed(() => {
  if (props.path === '/') return route.path === '/'
  return route.path === props.path || route.path.startsWith(`${props.path}/`)
})
</script>

<style scoped>
.sidebar-item {
  position: relative;
  display: flex;
  min-height: 2.8rem;
  align-items: center;
  gap: var(--space-3_5);
  overflow: hidden;
  padding: var(--space-2_5) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  transition: color var(--duration-fast) ease, background var(--duration-fast) ease, border-color var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
}

.sidebar-item:hover {
  border-color: transparent;
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-item--active {
  border-color: color-mix(in srgb, var(--accent) 18%, transparent);
  background: var(--accent-muted);
  box-shadow: none;
  color: var(--accent);
  font-weight: var(--font-weight-semibold);
}

.sidebar-item__label { display: grid; gap: var(--space-1); }
.sidebar-item__label small { color: var(--text-tertiary); font-size: var(--text-xs); font-weight: var(--font-weight-normal); }
.sidebar-item--active .sidebar-item__label small { color: var(--accent); opacity: .85; }
.sidebar-item--active::before { position: absolute; left: 0; width: 3px; height: 20px; border-radius: var(--radius-xs); background: var(--accent); content: ''; }

.sidebar-item--collapsed {
  justify-content: center;
  gap: 0;
  padding-inline: var(--space-1);
}

</style>
