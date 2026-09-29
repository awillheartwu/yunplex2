<template>
  <section class="section-card system-resources" aria-labelledby="system-resources-title">
    <header class="system-resources__header"><h2 id="system-resources-title">进程资源</h2><span>每 10 秒采样</span></header>
    <div class="system-resources__grid">
    <article v-for="card in cards" :key="card.label" class="system-kpi" :class="`system-kpi--${card.tone}`">
      <p>{{ card.label }}</p>
      <strong>{{ card.value }}</strong>
      <span>{{ card.detail }}</span>
    </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SystemKpiCard } from '~~/composables/useSystemMonitor'

defineProps<{ cards: SystemKpiCard[] }>()
</script>

<style scoped>
.system-resources { padding: var(--space-5); }
.system-resources__header { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-4); }
.system-resources__header h2 { margin: 0; }
.system-resources__header span { color: var(--text-tertiary); font-size: var(--text-xs); }
.system-resources__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.system-kpi { min-width: 0; padding-inline: var(--space-5); border-left: 1px solid var(--border-primary); }
.system-kpi:first-child { padding-left: 0; border-left: 0; }
.system-kpi p { margin: 0 0 var(--space-1); color: var(--text-secondary); font-size: var(--text-xs); }
.system-kpi strong { display: block; color: var(--text-primary); font-size: var(--text-2xl); font-weight: var(--font-weight-semibold); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.system-kpi span { display: block; margin-top: var(--space-1); color: var(--text-tertiary); font-size: var(--text-xs); overflow-wrap: anywhere; }
.system-kpi--warning strong { color: var(--warning); }
.system-kpi--error strong { color: var(--danger); }
@media(max-width:720px) {
  .system-resources { padding: var(--space-4); }
  .system-resources__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4) 0; }
  .system-kpi { padding-inline: var(--space-3); }
  .system-kpi:nth-child(odd) { padding-left: 0; border-left: 0; }
}
</style>
