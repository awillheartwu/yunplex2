<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <AppToastHost />
</template>

<script setup lang="ts">
import { useHead } from '#imports'

const { theme } = useTheme()
useHead(() => ({
  link: [{ key: 'yunplex-icon', rel: 'icon', type: 'image/svg+xml', href: theme.value === 'light' ? '/favicon-light.svg' : '/favicon.svg' }],
}))
</script>
