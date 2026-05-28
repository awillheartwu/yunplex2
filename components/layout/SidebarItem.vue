<template>
  <NuxtLink
    :to="path"
    :title="collapsed ? label : undefined"
    class="flex items-center rounded-lg text-[0.9375rem] transition-colors duration-150 overflow-hidden"
    :class="[
      collapsed ? 'justify-center px-1 py-2.5' : 'gap-4 px-3 py-2.5',
      isActive
        ? 'bg-accent-muted text-accent font-medium'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
    ]"
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

const route = useRoute()
const isActive = computed(() => {
  if (props.path === '/') return route.path === '/'
  return route.path.startsWith(props.path)
})
</script>
