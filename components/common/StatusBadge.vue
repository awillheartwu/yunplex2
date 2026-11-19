<template>
  <span
    class="inline-flex items-center rounded-full font-medium"
    :class="[sizeClasses, classes]"
  >
    <span class="rounded-full" :class="[dotSizeClass, dotClass]" />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  status: 'ok' | 'error' | 'warning' | 'running' | 'idle'
  size?: 'default' | 'sm'
  label?: string
}>(), {
  size: 'default',
  label: '',
})

const config = computed(() => {
  switch (props.status) {
    case 'ok': return { dot: 'bg-success', bg: 'semantic-success' }
    case 'error': return { dot: 'bg-danger', bg: 'semantic-failure' }
    case 'warning': return { dot: 'bg-warning', bg: 'semantic-warning' }
    case 'running': return { dot: 'bg-running animate-pulse', bg: 'semantic-running' }
    case 'idle': return { dot: 'bg-existing', bg: 'semantic-existing' }
  }
})

const labels: Record<string, string> = {
  ok: '正常',
  error: '失败',
  warning: '警告',
  running: '运行中',
  idle: '空闲',
}

const label = computed(() => props.label || labels[props.status])
const classes = computed(() => config.value.bg)
const dotClass = computed(() => config.value.dot)

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'gap-1 px-2 py-0.5 text-2xs'
    default:
      return 'gap-1.5 px-2.5 py-0.5 text-xs'
  }
})

const dotSizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-1.5 h-1.5'
    default:
      return 'w-2 h-2'
  }
})
</script>
