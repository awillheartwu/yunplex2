<template>
  <header class="page-header">
    <div class="page-header__copy">
      <p v-if="description" class="page-header__description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  description?: string
}>()
</script>

<style scoped>
.page-header {
  display: flex;
  min-width: 0;
  min-height: 2.25rem;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
}

.page-header__copy {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}

.page-header__description {
  max-width: 48rem;
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.55;
}

.page-header__actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (max-width: 767px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.85rem;
  }

  .page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
