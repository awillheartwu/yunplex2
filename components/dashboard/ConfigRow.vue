<template>
  <div class="flex items-center justify-between">
    <span class="text-sm text-muted">{{ label }}</span>
    <span
      class="text-sm"
      :class="isUnset ? 'text-[var(--text-tertiary)] italic' : 'text-[var(--text-primary)]'"
    >{{ isUnset ? '未配置' : value }}</span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  value: string
}>()

const isUnset = computed(() => !props.value || props.value === '' || props.value === '0' || props.value === '未配置')
</script>
