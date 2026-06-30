<template>
  <section class="section-card p-4">
    <p class="mb-3 text-2xs text-muted-deep">系统信息</p>
    <div class="space-y-2 text-xs">
      <InfoRow label="版本" :value="`YunPlex2 v${info?.version ?? '-'}`" />
      <InfoRow :label="info?.docker ? 'Docker' : '平台'" :value="info?.platform ?? '-'" />
      <InfoRow label="Node.js" :value="info?.nodeVersion ?? '-'" mono />
      <InfoRow label="PID" :value="stats?.pid ? String(stats.pid) : '-'" mono />
      <InfoRow label="运行时间" :value="formatUptime(stats?.uptime || 0)" />
      <InfoRow label="依赖检测" :value="dependencyCheckedLabel" />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SystemInfo, SystemStats } from '~~/composables/useSystemPage'

defineProps<{
  info: SystemInfo | null
  stats: SystemStats | null
  dependencyCheckedLabel: string
  formatUptime: (seconds: number) => string
}>()
</script>
