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

    <div v-else class="space-y-6">
      <SystemRunRecordsPanel />
      <SystemMaintenancePanel
        v-model:cleanup-from="cleanupFrom"
        v-model:cleanup-to="cleanupTo"
        v-model:cleanup-type="cleanupType"
        v-model:cleanup-status="cleanupStatus"
        v-model:show-run-cleanup-confirm="showRunCleanupConfirm"
        :can-cleanup="canCleanup"
        :cleanup-confirm-message="cleanupConfirmMessage"
        :cleanup-loading="cleanupLoading"
        :cleanup-message="cleanupMessage"
        :cleanup-preview-error="cleanupPreviewError"
        :cleanup-preview-loading="cleanupPreviewLoading"
        :cleanup-preview-message="cleanupPreviewMessage"
        @preview="fetchCleanupPreview"
        @confirm-cleanup="handleRunCleanup"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSystemPage } from '~~/composables/useSystemPage'

const {
  activeTab,
  canCleanup,
  cleanupFrom,
  cleanupConfirmMessage,
  cleanupLoading,
  cleanupMessage,
  cleanupPreviewError,
  cleanupPreviewLoading,
  cleanupPreviewMessage,
  cleanupStatus,
  cleanupTo,
  cleanupType,
  copyDiagnostics,
  cpuChartOption,
  dependencyCheckedLabel,
  fetchCleanupPreview,
  formatUptime,
  handleRunCleanup,
  healthItems,
  healthRefreshing,
  info,
  kpiCards,
  lastStatsLabel,
  memChartOption,
  overallTone,
  refreshDependencyHealth,
  showRunCleanupConfirm,
  stats,
  switchSystemTab,
  tableRows,
  tabs,
} = useSystemPage()
</script>
