<template>
  <AppIcon :name="name" :size="18" :class="active ? 'text-accent' : 'text-muted-deep'" />
</template>

<script setup lang="ts">
defineProps<{
  name: string
  active?: boolean
}>()
</script>
