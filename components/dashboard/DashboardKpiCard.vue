<template>
  <article class="section-card dashboard-kpi-card">
    <div class="dashboard-kpi-card__header">
      <div class="dashboard-kpi-card__icon" :class="`dashboard-kpi-card__icon--${kpi.tone}`">
        <AppIcon :name="kpi.icon" :size="18" />
      </div>
      <p class="dashboard-kpi-card__label">{{ kpi.label }}</p>
    </div>
    <p class="dashboard-kpi-card__value">{{ kpi.value }}</p>
    <p class="dashboard-kpi-card__note">{{ kpi.note }}</p>
  </article>
</template>

<script setup lang="ts">
import type { DashboardKpi } from '~~/types/dashboard'

defineProps<{
  kpi: DashboardKpi
}>()
</script>

<style scoped>
.dashboard-kpi-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.55rem;
  min-height: 7.4rem;
  padding: 0.9rem 1rem;
}

.dashboard-kpi-card__header {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
}

.dashboard-kpi-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  border: 1px solid var(--border-primary);
  background: var(--bg-input);
}

.dashboard-kpi-card__icon--accent {
  color: var(--accent);
  background: var(--accent-muted);
}

.dashboard-kpi-card__icon--success {
  color: var(--success);
  background: var(--success-soft);
}

.dashboard-kpi-card__icon--warning {
  color: var(--warning);
  background: var(--warning-soft);
}

.dashboard-kpi-card__icon--danger {
  color: var(--danger);
  background: var(--danger-soft);
}

.dashboard-kpi-card__icon--neutral {
  color: var(--text-tertiary);
}

.dashboard-kpi-card__label {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.dashboard-kpi-card__value {
  margin: 0;
  width: 100%;
  font-size: 2rem;
  line-height: 1;
  text-align: left;
  color: var(--text-primary);
  font-weight: 700;
}

.dashboard-kpi-card__note {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-tertiary);
}

@media (max-width: 767px) {
  .dashboard-kpi-card {
    min-height: auto;
    padding: 1rem;
  }

  .dashboard-kpi-card__value {
    font-size: 1.55rem;
  }
}
</style>
