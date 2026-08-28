<template>
  <NuxtLink
    :to="path"
    :title="collapsed ? label : undefined"
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
    <span v-show="!collapsed" class="whitespace-nowrap">{{ label }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
const props = defineProps<{
  icon: string
  label: string
  path: string
  collapsed?: boolean
}>()
defineEmits<{ navigate: [] }>()

const route = useRoute()
const isActive = computed(() => {
  if (props.path === '/') return route.path === '/'
  return route.path.startsWith(props.path)
})
</script>

<style scoped>
.sidebar-item {
  position: relative;
  display: flex;
  min-height: 2.65rem;
  align-items: center;
  gap: 0.85rem;
  overflow: hidden;
  padding: 0.65rem 0.8rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  transition: color 160ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
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
  font-weight: 750;
}

.sidebar-item--collapsed {
  justify-content: center;
  gap: 0;
  padding-inline: 0.25rem;
}

</style>
