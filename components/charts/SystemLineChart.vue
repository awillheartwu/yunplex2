<template>
  <VChart class="w-full" style="height:160px" :option="option" :autoresize="true" />
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
