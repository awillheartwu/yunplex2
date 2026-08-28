<template>
  <section class="section-card config-section" :class="{ 'config-section--open': !collapsed }">
    <button
      class="config-section__header"
      type="button"
      :aria-expanded="!collapsed"
      @click="$emit('toggle')"
    >
      <span class="config-section__heading">
        <span class="config-section__title-row">
          <span class="config-section__icon"><slot name="icon" /></span>
          <span class="config-section__title">{{ title }}</span>
        </span>
        <span class="config-section__description">{{ description }}</span>
      </span>
      <Chevron :open="!collapsed" />
    </button>
    <div v-show="!collapsed" class="config-section__body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ title: string; description: string; collapsed: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<style scoped>
.config-section {
  overflow: hidden;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

.config-section--open {
  border-color: var(--border-secondary);
}

.config-section__header {
  display: flex;
  width: 100%;
  min-height: 4rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.15rem;
  border: 0;
  border-bottom: 1px solid transparent;
  background: transparent;
  color: inherit;
  text-align: left;
  transition: background 160ms ease, border-color 160ms ease;
}

.config-section__header:hover {
  background: var(--bg-hover);
}

.config-section--open .config-section__header {
  border-bottom-color: var(--border-primary);
  background: var(--bg-input);
}

.config-section__heading {
  display: grid;
  min-width: 0;
  gap: 0.25rem;
}

.config-section__title-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.config-section__icon {
  display: inline-flex;
  color: var(--accent);
}

.config-section__title {
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 750;
}

.config-section__description {
  color: var(--text-tertiary);
  font-size: 0.72rem;
  line-height: 1.45;
}

.config-section__body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.15rem;
}

@media (max-width: 640px) {
  .config-section__header,
  .config-section__body {
    padding-inline: 1rem;
  }
}
</style>
