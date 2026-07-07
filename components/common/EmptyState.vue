<template>
  <section class="empty-state" role="status" aria-live="polite">
    <div class="empty-state__icon">
      <slot name="icon">
        <AppIcon name="list" :size="56" />
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
  padding: 3rem 1rem;
  color: var(--text-tertiary);
  text-align: center;
}

.empty-state__icon {
  margin-bottom: 1.5rem;
  opacity: 0.3;
}

.empty-state__title {
  margin: 0 0 0.25rem;
  color: var(--text-secondary);
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.35;
}

.empty-state__description {
  max-width: 28rem;
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.875rem;
  line-height: 1.6;
}

@media (max-width: 767px) {
  .empty-state {
    min-block-size: 12rem;
    padding-block: 2rem;
  }
}
</style>
