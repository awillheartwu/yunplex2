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
    <SystemCharts :cpu-chart-option="cpuChartOption" :mem-chart-option="memChartOption" :last-stats-label="lastStatsLabel" />
    <SystemDataStats :rows="tableRows" />
    <SystemInfoPanel
      :info="info"
      :stats="stats"
      :dependency-checked-label="dependencyCheckedLabel"
      :format-uptime="formatUptime"
    />
  </div>
</template>

<script setup lang="ts">
import type { SystemHealthItem, SystemInfo, SystemKpiCard, SystemStats } from '~~/composables/useSystemPage'
import type { SystemDataTableRow } from '~~/lib/system-data-catalog'

defineProps<{
  cpuChartOption: Record<string, unknown>
  dependencyCheckedLabel: string
  formatUptime: (seconds: number) => string
  healthItems: SystemHealthItem[]
  healthRefreshing: boolean
  info: SystemInfo | null
  kpiCards: SystemKpiCard[]
  lastStatsLabel: string
  memChartOption: Record<string, unknown>
  overallTone: 'ok' | 'warning' | 'error' | 'idle'
  stats: SystemStats | null
  tableRows: SystemDataTableRow[]
}>()

defineEmits<{
  'refresh-health': []
  'copy-diagnostics': []
}>()
</script>
