<template>
  <VChart class="system-line-chart w-full" :option="option" :autoresize="true" />
</template>

<script setup lang="ts">
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { TooltipComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

defineProps<{
  option: Record<string, unknown>
}>()

use([LineChart, TooltipComponent, GridComponent, CanvasRenderer])
</script>

<style scoped>
.system-line-chart {
  block-size: 100%;
  min-block-size: var(--chart-plot-min-block-size);
}
</style>
