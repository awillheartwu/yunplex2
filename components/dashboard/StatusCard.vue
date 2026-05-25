<template>
  <div class="section-card p-3.5">
    <p class="text-2xs font-medium mb-1" style="color:var(--text-tertiary)">{{ label }}</p>
    <div class="flex items-baseline gap-2">
      <span class="text-xl font-semibold tracking-tight" style="color:var(--text-primary)">{{ value }}</span>
      <span v-if="trend === 'ok'" class="text-2xs text-success font-medium">正常</span>
      <span v-else-if="trend === 'error'" class="text-2xs text-danger font-medium">异常</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: string; trend?: 'ok' | 'error' }>()
</script>
