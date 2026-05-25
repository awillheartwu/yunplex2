<template>
  <div class="flex items-center justify-between py-0.5">
    <span class="text-xs" style="color:var(--text-secondary)">{{ label }}</span>
    <span class="text-xs font-medium" :class="isUnset ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'">{{ isUnset ? '—' : value }}</span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  value: string
}>()

const isUnset = computed(() => !props.value || props.value === '' || props.value === '0' || props.value === '未配置')
</script>
