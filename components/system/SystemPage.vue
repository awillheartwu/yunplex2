<template>
  <div class="space-y-6">
    <PageHeader description="集中查看系统健康、诊断日志与运行记录" />

    <PageTabs
      :model-value="activeTab"
      :tabs="tabs"
      aria-label="系统视图"
      @change="switchSystemTab"
    />

    <SystemMonitorPanel
      v-if="activeTab === 'monitor'"
      :cpu-chart-option="cpuChartOption"
      :dependency-checked-label="dependencyCheckedLabel"
      :format-uptime="formatUptime"
      :health-items="healthItems"
      :health-refreshing="healthRefreshing"
      :info="info"
      :kpi-cards="kpiCards"
      :last-stats-label="lastStatsLabel"
      :mem-chart-option="memChartOption"
      :overall-tone="overallTone"
      :stats="stats"
      :table-rows="tableRows"
      @refresh-health="refreshDependencyHealth"
      @copy-diagnostics="copyDiagnostics"
    />

    <SystemLogsPanel v-else-if="activeTab === 'logs'" />

    <SystemRunRecordsPanel v-else />
  </div>
</template>

<script setup lang="ts">
import { useSystemPage } from '~~/composables/useSystemPage'

const {
  activeTab,
  copyDiagnostics,
  cpuChartOption,
  dependencyCheckedLabel,
  formatUptime,
  healthItems,
  healthRefreshing,
  info,
  kpiCards,
  lastStatsLabel,
  memChartOption,
  overallTone,
  refreshDependencyHealth,
  stats,
  switchSystemTab,
  tableRows,
  tabs,
} = useSystemPage()
</script>
