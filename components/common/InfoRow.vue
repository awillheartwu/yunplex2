<template>
  <div class="flex items-center justify-between">
    <span class="text-sm text-muted">{{ label }}</span>
    <span class="text-sm text-[var(--text-primary)]" :class="{ 'font-mono text-2xs': mono }">{{ value }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  value: string
  mono?: boolean
}>()
</script>
