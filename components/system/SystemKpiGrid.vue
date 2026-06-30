<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <article v-for="card in cards" :key="card.label" class="section-card system-kpi" :class="`system-kpi--${card.tone}`">
      <p>{{ card.label }}</p>
      <strong>{{ card.value }}</strong>
      <span>{{ card.detail }}</span>
    </article>
  </div>
</template>

<script setup lang="ts">
import type { SystemKpiCard } from '~~/composables/useSystemPage'

defineProps<{ cards: SystemKpiCard[] }>()
</script>

<style scoped>
.system-kpi {
  position: relative;
  overflow: hidden;
  padding: 1rem;
}

.system-kpi::before {
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 3px;
  content: '';
  background: var(--border-primary);
}

.system-kpi--ok::before { background: var(--success); }
.system-kpi--warning::before { background: var(--warning); }
.system-kpi--error::before { background: var(--danger); }

.system-kpi p {
  margin-bottom: 0.25rem;
  color: var(--text-tertiary);
  font-size: 0.7rem;
}

.system-kpi strong {
  display: block;
  color: var(--text-primary);
  font-size: 1.25rem;
  font-weight: 700;
}

.system-kpi span {
  margin-top: 0.25rem;
  display: block;
  color: var(--text-tertiary);
  font-size: 0.7rem;
}
</style>
