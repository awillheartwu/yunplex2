<template>
  <NuxtLink
    :to="path"
    class="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors duration-150"
    :class="isActive
      ? 'bg-accent-muted text-accent font-medium'
      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'"
  >
    <SidebarIcon :name="icon" :active="isActive" />
    <span>{{ label }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
const props = defineProps<{
  icon: string
  label: string
  path: string
}>()

const route = useRoute()
const isActive = computed(() => {
  if (props.path === '/') return route.path === '/'
  return route.path.startsWith(props.path)
})
</script>
