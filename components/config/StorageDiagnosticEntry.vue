<script setup lang="ts">
import type { StorageVisibilityDiagnostic } from '~~/server/lib/config/types'
const props = defineProps<{ diagnostic: StorageVisibilityDiagnostic }>()
const open = ref(false)
const title = computed(() => props.diagnostic.status === 'warning' ? '路径设置需要调整' : '路径设置一致')
</script>
<template>
  <aside class="diagnostic-entry" :class="{ 'diagnostic-entry--warning': diagnostic.status === 'warning' }">
    <AppIcon :name="diagnostic.status === 'warning' ? 'warn' : 'checkCircle'" :size="17" />
    <strong>{{ title }}</strong>
    <button class="btn btn-ghost btn-sm" type="button" @click="open = true">查看路径</button>
    <AppDrawer :visible="open" title="音乐目录检查" @close="open = false"><StorageVisibilityDiagnostic :diagnostic="diagnostic" /></AppDrawer>
  </aside>
</template>
<style scoped>
.diagnostic-entry { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--border-primary); border-radius: var(--radius-md); background: var(--bg-input); }
.diagnostic-entry > .app-icon { color: var(--success); }
.diagnostic-entry--warning { border-color: var(--warning-border); background: var(--warning-soft); }
.diagnostic-entry--warning > .app-icon { color: var(--warning); }
.diagnostic-entry strong { flex: 1; font-size: var(--text-sm); }
</style>
