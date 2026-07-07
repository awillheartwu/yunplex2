<template>
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <section class="system-chart-card section-card p-4">
      <div class="mb-2 flex items-center justify-between gap-3">
        <p class="text-2xs text-muted-deep">CPU 使用率</p>
        <span class="text-2xs text-muted">{{ lastStatsLabel }}</span>
      </div>
      <LazySystemLineChart :option="cpuChartOption" />
    </section>
    <section class="system-chart-card section-card p-4">
      <div class="mb-2 flex items-center justify-between gap-3">
        <p class="text-2xs text-muted-deep">内存使用</p>
        <span class="text-2xs text-muted">RSS MB</span>
      </div>
      <LazySystemLineChart :option="memChartOption" />
    </section>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  cpuChartOption: Record<string, unknown>
  memChartOption: Record<string, unknown>
  lastStatsLabel: string
}>()
</script>

<style scoped>
.system-chart-card {
  display: flex;
  min-block-size: var(--chart-card-min-block-size);
  flex-direction: column;
}

.system-chart-card :deep(.system-line-chart) {
  flex: 1;
}
</style>
