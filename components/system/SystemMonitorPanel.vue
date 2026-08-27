<template>
  <div class="space-y-4">
    <SystemHealthOverview
      :items="healthItems"
      :overall-tone="overallTone"
      :dependency-checked-label="dependencyCheckedLabel"
      :refreshing="healthRefreshing"
      @refresh="$emit('refresh-health')"
      @copy-diagnostics="$emit('copy-diagnostics')"
    />
    <SystemKpiGrid :cards="kpiCards" />
  </div>
</template>

<script setup lang="ts">
import type { SystemHealthItem, SystemKpiCard } from '~~/composables/useSystemMonitor'

defineProps<{
  dependencyCheckedLabel: string
  healthItems: SystemHealthItem[]
  healthRefreshing: boolean
  kpiCards: SystemKpiCard[]
  overallTone: 'ok' | 'warning' | 'error' | 'idle'
}>()

defineEmits<{
  'refresh-health': []
  'copy-diagnostics': []
}>()
</script>
