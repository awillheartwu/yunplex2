<template>
  <section class="dashboard-charts" aria-label="趋势图表">
    <article class="section-card dashboard-chart-card">
      <header class="dashboard-chart-card__header">
        <div>
          <h3>近七日下载</h3>
          <p>完成的歌曲下载任务</p>
        </div>
        <strong>{{ downloadTotal }} 首</strong>
      </header>

      <div v-if="!downloadTrend.length || downloadTotal === 0" class="dashboard-chart-empty" role="status">{{ downloadTrend.length ? '近七日暂无已完成下载' : '暂无下载统计' }}</div>
      <div v-else class="download-bars" role="img" :aria-label="downloadAriaLabel">
        <div v-for="point in downloadTrend" :key="point.date" class="download-bars__item">
          <div class="download-bars__plot">
            <span class="download-bars__value">{{ point.count }}</span>
            <span
              class="download-bars__bar"
              :class="{ 'download-bars__bar--empty': point.count === 0 }"
              :style="{ height: `${downloadHeight(point.count)}%` }"
            />
          </div>
          <span class="download-bars__label">{{ point.label }}</span>
        </div>
      </div>

      <table class="sr-only">
        <caption>近七日完成下载数量</caption>
        <thead><tr><th>日期</th><th>完成数量</th></tr></thead>
        <tbody><tr v-for="point in downloadTrend" :key="`table-${point.date}`"><td>{{ point.label }}</td><td>{{ point.count }}</td></tr></tbody>
      </table>
    </article>

    <article class="section-card dashboard-chart-card">
      <header class="dashboard-chart-card__header dashboard-chart-card__header--resource">
        <div>
          <h3>CPU 与内存</h3>
          <p>本页最近 5 分钟采样</p>
        </div>
        <div class="resource-legend" aria-label="当前资源占用">
          <span><i class="resource-legend__cpu" />CPU <strong>{{ latestResource ? `${latestResource.cpu}%` : '--' }}</strong></span>
          <span><i class="resource-legend__memory" />内存 <strong>{{ latestResource ? `${latestResource.memory} MB` : '--' }}</strong></span>
        </div>
      </header>

      <div v-if="resourceTrend.length < 2" class="dashboard-chart-empty" role="status">{{ resourceTrend.length ? '已收到首次采样，等待下一次更新生成趋势' : '等待资源采样' }}</div>
      <figure v-else class="resource-chart">
        <svg viewBox="0 0 600 180" preserveAspectRatio="none" role="img" :aria-label="resourceAriaLabel">
          <line v-for="line in gridLines" :key="line" x1="0" x2="600" :y1="line" :y2="line" class="resource-chart__grid" />
          <polyline v-if="resourceTrend.length > 1" :points="memoryPoints" class="resource-chart__line resource-chart__line--memory" />
          <polyline v-if="resourceTrend.length > 1" :points="cpuPoints" class="resource-chart__line resource-chart__line--cpu" />
          <circle :cx="latestX" :cy="latestMemoryY" r="4" class="resource-chart__point resource-chart__point--memory" vector-effect="non-scaling-stroke" />
          <circle :cx="latestX" :cy="latestCpuY" r="4" class="resource-chart__point resource-chart__point--cpu" vector-effect="non-scaling-stroke" />
        </svg>
        <figcaption class="resource-chart__axis">
          <span>{{ firstResourceTime }}</span>
          <span>{{ latestResourceTime }}</span>
        </figcaption>
      </figure>

      <table class="sr-only">
        <caption>CPU 与内存采样</caption>
        <thead><tr><th>时间</th><th>CPU 百分比</th><th>内存 MB</th></tr></thead>
        <tbody><tr v-for="point in resourceTrend" :key="point.timestamp"><td>{{ formatTime(point.timestamp) }}</td><td>{{ point.cpu }}</td><td>{{ point.memory }}</td></tr></tbody>
      </table>
    </article>
  </section>
</template>

<script setup lang="ts">
import type { SystemResourceTrendPoint } from '~~/composables/useSystemMonitor'
import type { DashboardDownloadTrendPoint } from '~~/types/dashboard'

const props = defineProps<{
  downloadTrend: DashboardDownloadTrendPoint[]
  resourceTrend: SystemResourceTrendPoint[]
}>()

const plotTop = 14
const plotBottom = 158
const plotHeight = plotBottom - plotTop
const gridLines = [14, 62, 110, 158]
const downloadTotal = computed(() => props.downloadTrend.reduce((sum, point) => sum + point.count, 0))
const downloadMax = computed(() => Math.max(1, ...props.downloadTrend.map(point => point.count)))
const latestResource = computed(() => props.resourceTrend.at(-1) ?? null)
const memoryMax = computed(() => Math.max(256, Math.ceil(Math.max(0, ...props.resourceTrend.map(point => point.memory)) / 128) * 128))

function downloadHeight(count: number): number {
  return count === 0 ? 2 : Math.max(8, count / downloadMax.value * 100)
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function xAt(index: number): number {
  return props.resourceTrend.length <= 1 ? 300 : index / (props.resourceTrend.length - 1) * 600
}

function yAt(value: number, max: number): number {
  return plotBottom - Math.min(Math.max(value / max, 0), 1) * plotHeight
}

const cpuPoints = computed(() => props.resourceTrend.map((point, index) => `${xAt(index)},${yAt(point.cpu, 100)}`).join(' '))
const memoryPoints = computed(() => props.resourceTrend.map((point, index) => `${xAt(index)},${yAt(point.memory, memoryMax.value)}`).join(' '))
const latestX = computed(() => xAt(Math.max(0, props.resourceTrend.length - 1)))
const latestCpuY = computed(() => yAt(latestResource.value?.cpu ?? 0, 100))
const latestMemoryY = computed(() => yAt(latestResource.value?.memory ?? 0, memoryMax.value))
const firstResourceTime = computed(() => props.resourceTrend[0] ? formatTime(props.resourceTrend[0].timestamp) : '')
const latestResourceTime = computed(() => latestResource.value ? formatTime(latestResource.value.timestamp) : '')
const downloadAriaLabel = computed(() => `近七日共完成 ${downloadTotal.value} 首下载。${props.downloadTrend.map(point => `${point.label} ${point.count} 首`).join('，')}`)
const resourceAriaLabel = computed(() => latestResource.value
  ? `CPU 与内存趋势，当前 CPU ${latestResource.value.cpu}%，内存 ${latestResource.value.memory} MB`
  : 'CPU 与内存趋势，等待采样')
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.dashboard-charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3_5); }
.dashboard-chart-card { min-width: 0; min-height: 13rem; padding: var(--space-4); }
.dashboard-chart-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-3); }
.dashboard-chart-card__header h3 { margin: 0; color: var(--text-primary); }
.dashboard-chart-card__header p { margin: var(--space-1) 0 0; color: var(--text-tertiary); font-size: var(--text-xs); }
.dashboard-chart-card__header > strong { color: var(--accent); font-size: var(--text-sm); }
.download-bars { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: clamp(.35rem, 1vw, .75rem); min-height: 8rem; }
.download-bars__item { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: var(--space-2); min-width: 0; }
.download-bars__plot { display: flex; align-items: center; justify-content: flex-end; flex-direction: column; min-height: 8.6rem; border-bottom: 1px solid var(--border-primary); }
.download-bars__value { margin-bottom: var(--space-1); color: var(--text-secondary); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.download-bars__bar { width: min(64%, 2.6rem); min-height: .2rem; border-radius: var(--radius-sm) var(--radius-sm) var(--radius-xs) var(--radius-xs); background: linear-gradient(180deg, var(--accent-soft), var(--accent)); box-shadow: 0 0 1rem color-mix(in srgb, var(--accent) 18%, transparent); }
.download-bars__bar--empty { background: var(--border-secondary); box-shadow: none; }
.download-bars__label { overflow: hidden; color: var(--text-tertiary); font-size: var(--text-xs); text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.dashboard-chart-card__header--resource { align-items: center; }
.resource-legend { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2) var(--space-3); color: var(--text-tertiary); font-size: var(--text-xs); }
.resource-legend span { display: inline-flex; align-items: center; gap: var(--space-1); white-space: nowrap; }
.resource-legend strong { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.resource-legend i { width: .48rem; height: .48rem; border-radius: var(--radius-full); }
.resource-legend__cpu { background: var(--accent); }
.resource-legend__memory { background: var(--success); }
.resource-chart { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 8rem; margin: 0; }
.resource-chart svg { width: 100%; height: 9.6rem; overflow: visible; }
.resource-chart__grid { stroke: var(--border-primary); stroke-width: 1; vector-effect: non-scaling-stroke; }
.resource-chart__line { fill: none; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.resource-chart__line--cpu, .resource-chart__point--cpu { stroke: var(--accent); }
.resource-chart__line--memory, .resource-chart__point--memory { stroke: var(--success); }
.resource-chart__point { fill: var(--bg-surface); stroke-width: 2.5; }
.resource-chart__axis { display: flex; justify-content: space-between; padding-top: var(--space-2); color: var(--text-tertiary); font-size: var(--text-xs); }
.dashboard-chart-empty { display: grid; place-items: center; min-height: 8rem; color: var(--text-tertiary); font-size: var(--text-xs); }
@media (max-width: 900px) { .dashboard-charts { grid-template-columns: 1fr; } }
@media (max-width: 560px) {
  .dashboard-chart-card { min-height: 13.5rem; padding: var(--space-3_5); }
  .dashboard-chart-card__header--resource { align-items: flex-start; flex-direction: column; }
  .resource-legend { justify-content: flex-start; }
  .download-bars { gap: var(--space-1); }
  .download-bars__bar { width: min(72%, 2rem); }
}
</style>
