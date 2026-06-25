<template>
  <nav class="page-tabs" role="tablist" :aria-label="ariaLabel">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      role="tab"
      class="page-tabs__tab"
      :class="{ 'page-tabs__tab--active': modelValue === tab.key }"
      :aria-selected="modelValue === tab.key"
      :disabled="tab.disabled"
      @click="selectTab(tab.key)"
    >
      <span>{{ tab.label }}</span>
      <span
        v-if="tab.count !== undefined"
        class="page-tabs__badge"
        :class="{ 'page-tabs__badge--danger': tab.badgeTone === 'danger' }"
      >
        {{ tab.count }}
      </span>
    </button>
  </nav>
</template>

<script setup lang="ts">
export interface PageTab {
  key: string
  label: string
  count?: number
  badgeTone?: 'neutral' | 'danger'
  disabled?: boolean
}

const props = defineProps<{
  modelValue: string
  tabs: PageTab[]
  ariaLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

function selectTab(key: string) {
  if (key === props.modelValue) return
  emit('update:modelValue', key)
  emit('change', key)
}
</script>

<style scoped>
.page-tabs {
  display: flex;
  min-width: 0;
  gap: 0.25rem;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-primary);
  scrollbar-width: none;
}

.page-tabs::-webkit-scrollbar {
  display: none;
}

.page-tabs__tab {
  position: relative;
  display: inline-flex;
  min-width: max-content;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0 1rem;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.875rem;
  font-weight: 650;
  line-height: 1;
  cursor: pointer;
  transition: color 150ms ease, background 150ms ease;
}

.page-tabs__tab::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 999px 999px 0 0;
  background: transparent;
  content: '';
}

.page-tabs__tab:hover:not(:disabled) {
  color: var(--text-primary);
  background: linear-gradient(to top, var(--bg-hover), transparent 65%);
}

.page-tabs__tab--active {
  color: var(--accent);
}

.page-tabs__tab--active::after {
  background: var(--accent);
}

.page-tabs__tab:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.page-tabs__badge {
  display: inline-flex;
  min-width: 1.35rem;
  height: 1.35rem;
  align-items: center;
  justify-content: center;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--accent-muted);
  color: var(--accent);
  font-size: 0.6875rem;
  font-weight: 750;
}

.page-tabs__badge--danger {
  background: var(--danger-soft);
  color: var(--danger);
}

@media (max-width: 767px) {
  .page-tabs__tab {
    min-height: 2.75rem;
    padding: 0 0.85rem;
  }
}
</style>
