<template>
  <section class="empty-state" role="status" aria-live="polite">
    <div class="empty-state__icon">
      <slot name="icon">
        <AppIcon name="list" :size="28" />
      </slot>
    </div>
    <p class="empty-state__title">{{ title }}</p>
    <p v-if="description" class="empty-state__description">{{ description }}</p>
    <slot />
  </section>
</template>

<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<style scoped>
.empty-state {
  display: flex;
  min-block-size: min(100%, 14rem);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-12) var(--space-4);
  color: var(--text-tertiary);
  text-align: center;
}

.empty-state__icon {
  display: grid;
  width: 4.5rem;
  height: 4.5rem;
  place-items: center;
  margin-bottom: var(--space-4);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-2xl);
  background: var(--accent-muted);
  color: var(--accent);
}

.empty-state__title {
  margin: 0 0 var(--space-1);
  color: var(--text-secondary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  line-height: 1.35;
}

.empty-state__description {
  max-width: 28rem;
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-base);
  line-height: 1.6;
}

@media (max-width: 767px) {
  .empty-state {
    min-block-size: 12rem;
    padding-block: var(--space-8);
  }
}
</style>
