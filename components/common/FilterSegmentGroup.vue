<template>
  <div class="filter-segment" role="group" :aria-label="ariaLabel || undefined">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="filter-segment__button"
      :class="{ 'filter-segment__button--active': option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      :disabled="disabled"
      @click="select(option.value)"
    >
      <span>{{ option.label }}</span>
      <span v-if="option.count !== undefined" class="filter-segment__count">{{ option.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
const props = withDefaults(defineProps<{
  modelValue: T
  options: ReadonlyArray<{ value: T; label: string; count?: number }>
  ariaLabel?: string
  disabled?: boolean
}>(), {
  ariaLabel: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: T]
  change: [value: T]
}>()

function select(value: T) {
  if (value === props.modelValue) return
  emit('update:modelValue', value)
  emit('change', value)
}
</script>
