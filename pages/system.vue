<template>
  <SystemPage />
</template>

<script setup lang="ts">
import { redirectLegacySystemRoute } from '~~/composables/useSystemPage'

const route = useRoute()
await redirectLegacySystemRoute(route)
</script>
