<template>
  <TaskCenterPage />
</template>

<script setup lang="ts">
const route = useRoute()
const requestedTab = String(route.query.tab || '')
const legacyRunTabs = new Set(['runs', 'activities', 'sync-history', 'download-history'])
const legacyId = typeof route.query.id === 'string' ? route.query.id : ''

if (legacyId) {
  await navigateTo(`/task-center/runs/${legacyId}`, { replace: true, redirectCode: 302 })
} else if (legacyRunTabs.has(requestedTab)) {
  await navigateTo({ path: '/system', query: { ...route.query, tab: 'runs', id: undefined } }, { replace: true, redirectCode: 302 })
}
</script>
