<template>
  <span
    class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium"
    :class="classes"
  >
    <span class="w-2 h-2 rounded-full" :class="dotClass" />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{
  status: 'ok' | 'error' | 'warning' | 'running' | 'idle'
}>()

const config = computed(() => {
  switch (props.status) {
    case 'ok': return { dot: 'bg-success', bg: 'bg-[#2ecc7118] text-success' }
    case 'error': return { dot: 'bg-danger', bg: 'bg-[#e74c3c18] text-danger' }
    case 'warning': return { dot: 'bg-warning', bg: 'bg-[#f1c40f18] text-warning' }
    case 'running': return { dot: 'bg-accent animate-pulse', bg: 'bg-accent-muted text-accent' }
    case 'idle': return { dot: 'bg-muted-deep', bg: 'bg-[#6b6b6b18] text-muted-deep' }
  }
})

const labels: Record<string, string> = {
  ok: '正常',
  error: '失败',
  warning: '警告',
  running: '同步中',
  idle: '空闲',
}

const label = computed(() => labels[props.status])
const classes = computed(() => config.value.bg)
const dotClass = computed(() => config.value.dot)
</script>
