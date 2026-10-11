<script setup lang="ts">
import type { StorageVisibilityDiagnostic } from '~~/server/lib/config/types'
defineProps<{ diagnostic: StorageVisibilityDiagnostic }>()
const open = ref(false)
const expanded = defineModel<boolean>('expanded', { default: true })
</script>
<template>
  <aside class="diagnostic-entry" :class="{ 'diagnostic-entry--warning': diagnostic.status !== 'verified' }">
    <div class="diagnostic-entry__row">
      <AppIcon :name="diagnostic.status === 'verified' ? 'checkCircle' : 'warn'" :size="17" />
      <strong>{{ diagnostic.status === 'verified' ? '文件发布链路已验证' : '文件发布链路待确认' }}</strong>
      <button class="btn btn-secondary" type="button" @click="open = true">查看诊断</button>
      <button class="icon-button" type="button" :aria-expanded="expanded" :aria-label="expanded ? '收起诊断提示' : '展开诊断提示'" @click="expanded = !expanded"><Chevron :open="expanded" /></button>
    </div>
    <p v-if="expanded">{{ diagnostic.summary }} 详细检查与建议已移至右侧诊断面板。</p>
    <AppDrawer :visible="open" title="文件发布诊断" @close="open = false"><StorageVisibilityDiagnostic :diagnostic="diagnostic" /></AppDrawer>
  </aside>
</template>
<style scoped>
.diagnostic-entry { padding: var(--space-3) var(--space-4); border: 1px solid var(--border-primary); border-radius: var(--radius-md); background: var(--bg-input); }
.diagnostic-entry--warning { border-color: var(--warning-border); background: var(--warning-soft); }
.diagnostic-entry__row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.diagnostic-entry__row strong { flex: 1; font-size: var(--text-sm); }
.diagnostic-entry--warning .diagnostic-entry__row > svg { color: var(--warning); }
.diagnostic-entry p { color: var(--text-secondary); font-size: var(--text-sm); margin: var(--space-2) 0 0; }
</style>
