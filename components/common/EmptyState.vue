<template>
  <div class="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
    <div class="mb-4 opacity-40">
      <slot name="icon">
        <svg width="40" height="40" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2.5" width="12" height="2.2" rx="1" stroke="currentColor" stroke-width="1.3" />
          <rect x="2" y="6.9" width="9" height="2.2" rx="1" stroke="currentColor" stroke-width="1.3" />
          <rect x="2" y="11.3" width="7" height="2.2" rx="1" stroke="currentColor" stroke-width="1.3" />
        </svg>
      </slot>
    </div>
    <p class="text-sm font-medium">{{ title }}</p>
    <p v-if="description" class="text-2xs mt-1">{{ description }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>
