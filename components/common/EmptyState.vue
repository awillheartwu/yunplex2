<template>
  <div class="flex flex-col items-center justify-center py-24" style="color:var(--text-tertiary)">
    <div class="mb-6 opacity-30">
      <slot name="icon">
        <svg width="56" height="56" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2.5" width="12" height="2.2" rx="1" stroke="currentColor" stroke-width="1.2" />
          <rect x="2" y="6.9" width="9" height="2.2" rx="1" stroke="currentColor" stroke-width="1.2" />
          <rect x="2" y="11.3" width="7" height="2.2" rx="1" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </slot>
    </div>
    <p class="text-base font-medium mb-1" style="color:var(--text-secondary)">{{ title }}</p>
    <p v-if="description" class="text-sm" style="color:var(--text-tertiary)">{{ description }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>
