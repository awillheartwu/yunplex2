<template>
  <div class="flex flex-col chart-root">
    <div class="flex items-center justify-between mb-2 shrink-0">
      <div class="flex items-center gap-0.5 p-0.5 rounded-lg" style="background:var(--bg-input)">
        <button
          v-for="mode in modes" :key="mode.key"
          class="download-chart__mode-button"
          type="button"
          :aria-pressed="chartMode === mode.key"
          :style="chartMode === mode.key
            ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-xs)' }
            : { color: 'var(--text-tertiary)' }"
          @click="chartMode = mode.key"
        >{{ mode.label }}</button>
      </div>
      <span class="text-2xs" style="color:var(--text-tertiary)">近 {{ days }} 天 · 共 {{ totalCount }} 首</span>
    </div>

    <div v-if="totalCount === 0" class="flex-1 flex items-center justify-center">
      <span class="text-xs text-muted">暂无下载数据</span>
    </div>
    <v-chart
      v-else
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
const { theme } = useTheme()
const modes = [
  { key: 'bar' as const, label: '柱状' },
  { key: 'line' as const, label: '折线' },
]

const totalCount = computed(() => props.data.reduce((s, d) => s + d.count, 0))

const chartPalette = computed(() => theme.value === 'dark'
  ? {
      axis: '#8ea0bd',
      grid: 'rgba(143,166,209,0.12)',
      barStart: '#7c93ff',
      barEnd: 'rgba(70,199,255,0.25)',
      emphasis: '#a7b7ff',
      line: '#7c93ff',
      areaStart: 'rgba(124,147,255,0.28)',
      areaEnd: 'rgba(124,147,255,0)',
    }
  : {
      axis: '#6d778b',
      grid: 'rgba(38,56,91,0.09)',
      barStart: '#3159c7',
      barEnd: 'rgba(93,130,229,0.28)',
      emphasis: '#21439e',
      line: '#3159c7',
      areaStart: 'rgba(49,89,199,0.2)',
      areaEnd: 'rgba(49,89,199,0)',
    })

const option = computed(() => ({
  grid: { top: 8, right: 0, bottom: 0, left: 0, containLabel: true },
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
    axisLine: { lineStyle: { color: chartPalette.value.grid } },
    axisTick: { show: false },
    axisLabel: { color: chartPalette.value.axis, fontSize: 10, margin: 10 },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    axisLabel: { color: chartPalette.value.axis, fontSize: 10 },
    splitLine: { lineStyle: { color: chartPalette.value.grid } },
  },
  series: [{
    type: chartMode.value,
    data: props.data.map(d => d.count),
    ...(chartMode.value === 'bar' ? {
      barWidth: '54%',
      barCategoryGap: '30%',
      itemStyle: {
        borderRadius: [5, 5, 0, 0],
        color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: chartPalette.value.barStart },
            { offset: 1, color: chartPalette.value.barEnd },
          ],
        },
      },
      emphasis: { itemStyle: { color: chartPalette.value.emphasis } },
    } : {
      lineStyle: { color: chartPalette.value.line, width: 2 },
      areaStyle: {
        color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: chartPalette.value.areaStart },
            { offset: 1, color: chartPalette.value.areaEnd },
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
.chart-root {
  block-size: 100%;
  min-block-size: var(--chart-card-min-block-size);
}

.chart {
  min-block-size: var(--chart-plot-min-block-size);
}

.download-chart__mode-button {
  display: inline-flex;
  min-block-size: 2rem;
  align-items: center;
  justify-content: center;
  padding-inline: 0.65rem;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 650;
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease, box-shadow 150ms ease;
}

.download-chart__mode-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px var(--accent-glow);
}
</style>
