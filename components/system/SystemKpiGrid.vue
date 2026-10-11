<template>
  <section class="section-card system-resources" aria-labelledby="system-resources-title">
    <header class="system-resources__header">
      <h2 id="system-resources-title">进程资源</h2>
      <span>每 10 秒采样</span>
    </header>
    <div class="system-resources__grid">
      <article v-for="card in cards" :key="card.key" class="system-kpi" :class="`system-kpi--${card.key === 'memory' && selectedMemory !== 'rss' ? 'idle' : card.tone}`">
        <p>{{ card.label }}</p>
        <template v-if="card.key === 'memory' && activeMemory">
          <ActionHint class="system-memory__hint" :text="memoryHint">
            <button
              type="button"
              class="system-memory__reading"
              :aria-label="`切换内存指标，当前${activeMemory.label} ${activeMemory.value}`"
              @click="cycleMemory"
            >
              <strong>{{ memoryReading.amount }}</strong>
              <small>{{ memoryReading.unit }}</small>
              <AppIcon name="chevronRight" :size="12" class="system-memory__next" />
            </button>
          </ActionHint>
          <span class="system-kpi__detail">{{ activeMemory.label }} · {{ activeMemory.detail }}</span>
        </template>
        <template v-else>
          <strong :title="card.exactValue">{{ card.value }}</strong>
          <span class="system-kpi__detail">{{ card.detail }}</span>
        </template>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SystemKpiCard } from '~~/composables/useSystemMonitor'
import type { SystemMemoryDetails, SystemMemoryMetric } from '~~/lib/system-memory'

const props = defineProps<{ cards: SystemKpiCard[]; memoryDetails: SystemMemoryDetails | null }>()
const selectedMemory = ref<SystemMemoryMetric['key']>('rss')
const activeMemory = computed(() => props.memoryDetails?.metrics.find(metric => metric.key === selectedMemory.value) ?? null)
const memoryReading = computed(() => {
  const [amount = '--', unit = ''] = activeMemory.value?.value.split(' ') ?? []
  return { amount, unit }
})
const memoryHint = computed(() => {
  const memory = activeMemory.value
  const context = props.memoryDetails
  if (!memory || !context) return ''
  return `点按读数切换 RSS、堆、外部、缓冲。${memory.description}采样：${context.modeLabel} · ${context.threadLabel}。`
    + (memory.exactValue ? `原始计数：${memory.exactValue}。` : '')
    + '1 MiB = 1,048,576 字节。'
})

function cycleMemory() {
  const metrics = props.memoryDetails?.metrics ?? []
  const index = metrics.findIndex(metric => metric.key === selectedMemory.value)
  selectedMemory.value = metrics[(index + 1) % metrics.length]?.key ?? 'rss'
}
</script>

<style scoped>
.system-resources { padding: var(--space-5); }
.system-resources__header { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-4); }
.system-resources__header h2 { margin: 0; }
.system-resources__header span { color: var(--text-tertiary); font-size: var(--text-xs); }
.system-resources__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.system-kpi { min-width: 0; padding-inline: var(--space-5); border-left: 1px solid var(--border-primary); }
.system-kpi:first-child { padding-left: 0; border-left: 0; }
.system-kpi p { margin: 0 0 var(--space-1); color: var(--text-secondary); font-size: var(--text-xs); }
.system-kpi strong { display: block; color: var(--text-primary); font-size: var(--text-2xl); font-weight: var(--font-weight-semibold); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.system-kpi > strong { display: flex; align-items: center; min-height: var(--control-height); }
.system-kpi__detail { display: block; margin-top: var(--space-1); color: var(--text-tertiary); font-size: var(--text-xs); overflow-wrap: anywhere; }
.system-kpi--warning strong { color: var(--warning); }
.system-kpi--error strong { color: var(--danger); }
.system-memory__hint { width: 100%; }
.system-memory__reading { display: flex; align-items: baseline; gap: var(--space-1); max-width: 100%; min-height: var(--control-height); padding: 0; border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; }
.system-memory__reading strong { min-width: 0; color: inherit; }
.system-memory__reading small { flex-shrink: 0; color: var(--text-secondary); font-size: var(--text-xs); }
.system-memory__next { align-self: center; flex-shrink: 0; color: var(--text-tertiary); }
.system-memory__reading:hover { color: var(--accent); }
.system-kpi--warning .system-memory__reading { color: var(--warning); }
.system-kpi--error .system-memory__reading { color: var(--danger); }
@media(max-width:720px) {
  .system-resources { padding: var(--space-4); }
  .system-resources__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4) 0; }
  .system-kpi { padding-inline: var(--space-3); }
  .system-kpi:nth-child(odd) { padding-left: 0; border-left: 0; }
}
</style>
