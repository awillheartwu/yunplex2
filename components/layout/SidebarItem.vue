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
  min-height: 2.8rem;
  align-items: center;
  gap: 0.85rem;
  overflow: hidden;
  padding: 0.65rem 0.8rem;
  border: 1px solid transparent;
  border-radius: 0.8rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  transition: color 160ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.sidebar-item::before {
  position: absolute;
  inset-block: 0.65rem;
  inset-inline-start: 0;
  width: 3px;
  border-radius: 0 999px 999px 0;
  background: transparent;
  content: "";
}

.sidebar-item:hover {
  border-color: color-mix(in srgb, var(--border-primary) 65%, transparent);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-item--active {
  border-color: color-mix(in srgb, var(--accent) 16%, transparent);
  background: linear-gradient(90deg, var(--accent-muted), color-mix(in srgb, var(--accent-muted) 40%, transparent));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);
  color: var(--accent);
  font-weight: 750;
}

.sidebar-item--active::before {
  background: var(--accent);
}

.sidebar-item--collapsed {
  justify-content: center;
  gap: 0;
  padding-inline: 0.25rem;
}

.sidebar-item--collapsed::before {
  inset-block: 0.8rem;
}
</style>
