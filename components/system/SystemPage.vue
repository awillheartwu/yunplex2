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
      :dependency-checked-label="dependencyCheckedLabel"
      :health-items="healthItems"
      :health-refreshing="healthRefreshing"
      :kpi-cards="kpiCards"
      :overall-tone="overallTone"
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
  dependencyCheckedLabel,
  healthItems,
  healthRefreshing,
  kpiCards,
  overallTone,
  refreshDependencyHealth,
  switchSystemTab,
  tabs,
} = useSystemPage()
</script>
