<template>
  <AppIcon
    name="chevronRight"
    :size="16"
    class="transition-transform duration-200 text-muted"
    :class="open ? 'rotate-90' : ''"
  />
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>()
</script>
