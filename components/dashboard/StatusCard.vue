<template>
  <div class="bg-surface border border-[var(--border-primary)] rounded-xl p-4">
    <p class="text-2xs text-muted-deep mb-1">{{ label }}</p>
    <div class="flex items-baseline gap-2">
      <span class="text-lg font-semibold">{{ value }}</span>
      <span v-if="trend === 'ok'" class="text-2xs text-success">正常</span>
      <span v-else-if="trend === 'error'" class="text-2xs text-danger">异常</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  value: string
  trend?: 'ok' | 'error'
}>()
</script>
