<template>
  <NuxtLink
    :to="path"
    :title="collapsed ? label : undefined"
    class="flex items-center overflow-hidden rounded-xl text-[0.9375rem] transition-all duration-150"
    :class="[
      collapsed ? 'justify-center px-1 py-3' : 'gap-3.5 px-3.5 py-3',
      isActive
        ? 'bg-accent-muted text-accent font-medium shadow-sm'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
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
