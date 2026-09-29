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
          <span class="config-section__title type-h3" role="heading" aria-level="3">{{ title }}</span>
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
  transition: border-color var(--duration-fast) ease, box-shadow var(--duration-fast) ease;
}

.config-section--open {
  border-color: var(--border-primary);
}

.config-section__header {
  display: flex;
  width: 100%;
  min-height: 4rem;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: 0;
  border-bottom: 1px solid transparent;
  background: transparent;
  color: inherit;
  text-align: left;
  transition: background var(--duration-fast) ease, border-color var(--duration-fast) ease;
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
  gap: var(--space-1);
}

.config-section__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.config-section__icon {
  display: inline-flex;
  color: var(--accent);
}

.config-section__title {
  color: var(--text-primary);
}

.config-section__description {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: var(--body-leading);
}

.config-section__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
}

@media (max-width: 640px) {
  .config-section__header,
  .config-section__body {
    padding-inline: var(--space-4);
  }
}
</style>
