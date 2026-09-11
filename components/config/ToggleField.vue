<template>
  <div class="toggle-field">
    <div class="min-w-0">
      <p class="text-sm font-medium text-[var(--text-primary)]">{{ label }}</p>
      <p v-if="hint" class="text-2xs text-muted-deep mt-0.5">{{ hint }}</p>
    </div>
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="label"
      class="toggle-field__switch"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span class="toggle-field__track" :class="{ 'toggle-field__track--on': modelValue }">
        <span class="toggle-field__thumb" :class="{ 'toggle-field__thumb--on': modelValue }" />
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean
  label: string
  hint?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<style scoped>
.toggle-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 3.5rem;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease;
}

.toggle-field:hover {
  border-color: var(--border-secondary);
  background: var(--bg-input);
}

.toggle-field__switch {
  position: relative;
  display: inline-flex;
  inline-size: 2.75rem;
  block-size: 2.75rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
}

.toggle-field__switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px var(--accent-glow);
}

.toggle-field__track {
  position: relative;
  display: block;
  inline-size: 2.25rem;
  block-size: 1.25rem;
  border-radius: var(--radius-full);
  background: var(--border-secondary);
  transition: background var(--duration-fast) ease;
}

.toggle-field__track--on {
  background: var(--accent);
}

.toggle-field__thumb {
  position: absolute;
  inset-block-start: 0.125rem;
  inset-inline-start: 0.125rem;
  display: block;
  inline-size: 1rem;
  block-size: 1rem;
  border-radius: var(--radius-full);
  background: var(--on-solid);
  box-shadow: var(--shadow-xs);
  transition: transform var(--duration-fast) ease;
}

.toggle-field__thumb--on {
  transform: translateX(1rem);
}
</style>
