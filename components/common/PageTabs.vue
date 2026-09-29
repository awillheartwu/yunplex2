<template>
  <nav class="page-tabs" role="tablist" :aria-label="resolvedAriaLabel">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      role="tab"
      class="page-tabs__tab"
      :class="{ 'page-tabs__tab--active': modelValue === tab.key }"
      :aria-selected="modelValue === tab.key"
      :disabled="tab.disabled"
      :tabindex="focusKey === tab.key ? 0 : -1"
      @keydown="onTabKeydown($event, tab.key)"
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
import { useAttrs } from 'vue'

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
  ariaLabel?: string
}>()

const focusKey = computed(() => props.tabs.some(tab => tab.key === props.modelValue && !tab.disabled) ? props.modelValue : props.tabs.find(tab => !tab.disabled)?.key)
const attrs = useAttrs()
const resolvedAriaLabel = computed(() => {
  const ariaLabelAttr = attrs['aria-label']
  return props.ariaLabel ?? (typeof ariaLabelAttr === 'string' ? ariaLabelAttr : undefined) ?? '页面切换'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

function onTabKeydown(event: KeyboardEvent, key: string) {
  const enabled = props.tabs.filter(tab => !tab.disabled)
  const index = enabled.findIndex(tab => tab.key === key)
  let next: number
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % enabled.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = enabled.length - 1
  else return
  event.preventDefault()
  selectTab(enabled[next]!.key)
  const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
  buttons?.[next]?.focus()
}

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
  gap: var(--space-1);
  padding: var(--space-1);
  overflow-x: auto;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  scrollbar-width: none;
}

.page-tabs::-webkit-scrollbar {
  display: none;
}

.page-tabs__tab {
  position: relative;
  display: inline-flex;
  min-width: max-content;
  min-height: 2.5rem;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0 var(--space-3_5);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
  line-height: 1;
  cursor: pointer;
  transition: color var(--duration-fast) ease, background var(--duration-fast) ease;
}

.page-tabs__tab::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: var(--radius-full) var(--radius-full) 0 0;
  background: transparent;
  content: '';
}

.page-tabs__tab:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.page-tabs__tab--active,
.page-tabs__tab--active:hover:not(:disabled) {
  color: var(--accent);
  background: var(--accent-muted);
}

.page-tabs__tab--active::after {
  background: transparent;
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
  padding: 0 var(--space-1_5);
  border-radius: var(--radius-full);
  background: var(--accent-muted);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-bold);
}

.page-tabs__badge--danger {
  background: var(--danger-soft);
  color: var(--danger);
}

@media (max-width: 767px) {
  .page-tabs__tab {
    min-height: 2.75rem;
    padding: 0 var(--space-3_5);
  }
}
</style>
