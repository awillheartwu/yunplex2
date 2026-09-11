<template>
  <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
    <article v-for="card in cards" :key="card.label" class="section-card system-kpi" :class="`system-kpi--${card.tone}`">
      <p>{{ card.label }}</p>
      <strong>{{ card.value }}</strong>
      <span>{{ card.detail }}</span>
    </article>
  </div>
</template>

<script setup lang="ts">
import type { SystemKpiCard } from '~~/composables/useSystemMonitor'

defineProps<{ cards: SystemKpiCard[] }>()
</script>

<style scoped>
.system-kpi {
  position: relative;
  overflow: hidden;
  padding: var(--space-5);
}

.system-kpi::before {
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2px;
  content: '';
  background: var(--border-primary);
}

.system-kpi--ok::before { background: var(--success); }
.system-kpi--warning::before { background: var(--warning); }
.system-kpi--error::before { background: var(--danger); }

.system-kpi p {
  margin-bottom: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.system-kpi strong {
  display: block;
  color: var(--text-primary);
  font-size: var(--text-2xl);
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-weight-bold);
}

.system-kpi span {
  margin-top: var(--space-1);
  display: block;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
</style>
