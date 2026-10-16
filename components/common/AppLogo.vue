<template>
  <img :src="theme === 'light' ? '/favicon-light.svg' : '/favicon.svg'" alt="" aria-hidden="true" :width="size" :height="size" class="app-logo" >
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 40 })
const { theme } = useTheme()
</script>

<style scoped>
.app-logo {
  display: block;
  flex: none;
  object-fit: contain;
}
</style>
