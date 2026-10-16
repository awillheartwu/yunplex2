<template>
  <span
    class="connection-status"
    :class="pending ? 'connection-status--pending' : result ? (result.ok ? 'connection-status--success' : 'connection-status--error') : ''"
    :title="message"
    role="status"
  ><span class="sr-only">{{ message }}</span></span>
</template>

<script setup lang="ts">
import type { ConfigConnectionResult } from '~/composables/useConfigConnections'
const props = defineProps<{ pending?: boolean; result?: ConfigConnectionResult }>()
const message = computed(() => props.pending ? '正在检查连接' : props.result?.message ?? '尚未检查连接')
</script>

<style scoped>
.connection-status {
  display: inline-block;
  flex: 0 0 auto;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: var(--radius-full);
  background: var(--text-tertiary);
}
.connection-status--pending { background: var(--warning); }
.connection-status--success { background: var(--success); }
.connection-status--error { background: var(--danger); }
</style>
