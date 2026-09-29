<template>
  <section class="empty-state" role="status" aria-live="polite">
    <div class="empty-state__icon">
      <slot name="icon">
        <AppIcon name="list" :size="28" />
      </slot>
    </div>
    <h3 class="empty-state__title">{{ title }}</h3>
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
  min-block-size: 10rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-6) var(--space-4);
  color: var(--text-tertiary);
  text-align: center;
}

.empty-state__icon {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  margin-bottom: var(--space-3);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-tertiary);
}

.empty-state__title {
  margin: 0 0 var(--space-1);
  color: var(--text-secondary);
}

.empty-state__description {
  max-width: 28rem;
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: var(--body-leading);
}

@media (max-width: 767px) {
  .empty-state {
    min-block-size: 10rem;
    padding-block: var(--space-6);
  }
}
.empty-state :deep(.btn) { margin-top: var(--space-4); }
</style>
