<template>
  <div class="flex flex-col chart-root">
    <div class="flex items-center justify-between mb-3 shrink-0">
      <div class="flex items-center gap-0.5 p-0.5 rounded-lg" style="background:var(--bg-input)">
        <button
          v-for="mode in modes" :key="mode.key"
          class="text-xs px-3 py-1 rounded-md transition-all duration-150 cursor-pointer"
          :style="chartMode === mode.key
            ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-xs)' }
            : { color: 'var(--text-tertiary)' }"
          @click="chartMode = mode.key"
        >{{ mode.label }}</button>
      </div>
      <span class="text-2xs" style="color:var(--text-tertiary)">近 {{ days }} 天 · 共 {{ totalCount }} 首</span>
    </div>

    <v-chart
      class="chart flex-1"
      :option="option"
      :autoresize="true"
    />
  </div>
</template>

<script setup lang="ts">
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { TooltipComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([BarChart, LineChart, TooltipComponent, GridComponent, CanvasRenderer])

const props = withDefaults(defineProps<{
  data: { date: string; count: number }[]
  days?: number
}>(), { days: 7 })

const chartMode = ref<'bar' | 'line'>('bar')
const modes = [
  { key: 'bar' as const, label: '柱状' },
  { key: 'line' as const, label: '折线' },
]

const totalCount = computed(() => props.data.reduce((s, d) => s + d.count, 0))

const option = computed(() => ({
  grid: { top: 8, right: 0, bottom: 0, left: 0 },
  tooltip: {
    backgroundColor: 'rgba(24,24,27,0.96)',
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    padding: [10, 14],
    textStyle: { color: '#f4f4f6', fontSize: 13, fontWeight: 600 },
    formatter(params: { name: string; value: number }) {
      return `${params.name}<br/><span style="color:#a1a1aa;font-size:11px;font-weight:400">下载 </span>${params.value} 首`
    },
  },
  xAxis: {
    type: 'category',
    data: props.data.map(d => {
      const dt = new Date(d.date)
      return `${dt.getMonth() + 1}/${dt.getDate()}`
    }),
    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    axisTick: { show: false },
    axisLabel: { color: '#71717a', fontSize: 11 },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    axisLabel: { color: '#71717a', fontSize: 11 },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)' } },
  },
  series: [{
    type: chartMode.value,
    data: props.data.map(d => d.count),
    ...(chartMode.value === 'bar' ? {
      barWidth: '60%',
      barCategoryGap: '30%',
      itemStyle: {
        borderRadius: [5, 5, 0, 0],
        color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(129,140,248,0.9)' },
            { offset: 1, color: 'rgba(99,102,241,0.3)' },
          ],
        },
      },
      emphasis: { itemStyle: { color: '#a5b4fc' } },
    } : {
      lineStyle: { color: '#818cf8', width: 2 },
      areaStyle: {
        color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(99,102,241,0.2)' },
            { offset: 1, color: 'rgba(99,102,241,0)' },
          ],
        },
      },
      symbolSize: 7,
      smooth: true,
    }),
  }],
}))
</script>

<style scoped>
.chart-root { min-height: 200px; }
</style>
