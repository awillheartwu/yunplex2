<template>
  <header class="page-header">
    <div class="page-header__copy">
      <p v-if="eyebrow" class="page-header__eyebrow">{{ eyebrow }}</p>
      <h1 class="page-header__title">{{ title || context.title }}</h1>
      <p v-if="description" class="page-header__description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { pageContext } from '~/lib/navigation'

defineProps<{
  title?: string
  eyebrow?: string
  description?: string
}>()
const route = useRoute()
const context = computed(() => pageContext(route.path))
</script>

<style scoped>
.page-header {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  min-height: 2.25rem;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-5);
}

.page-header__copy {
  display: grid;
  flex: 1 1 20rem;
  gap: var(--space-2);
  min-width: 0;
}

.page-header__eyebrow { margin: 0; color: var(--text-tertiary); font-size: var(--text-xs); font-weight: var(--font-weight-semibold); letter-spacing: .1em; }
.page-header__title { margin: 0; color: var(--text-primary); }

.page-header__description {
  max-width: 48rem;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: var(--font-weight-normal);
  line-height: var(--body-leading);
}

.page-header__actions {
  display: flex;
  flex: none;
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 767px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3_5);
  }

  .page-header__copy { flex: initial; }

  .page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
