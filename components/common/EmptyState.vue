<template>
  <div class="flex flex-col items-center justify-center py-24" style="color:var(--text-tertiary)">
    <div class="mb-6 opacity-30">
      <slot name="icon">
        <AppIcon name="list" :size="56" />
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
