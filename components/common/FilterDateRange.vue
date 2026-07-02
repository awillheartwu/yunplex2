<template>
  <div class="filter-sheet-group">
    <p class="filter-sheet-group__label">{{ label }}</p>
    <DateRange
      :model-value="modelValue"
      :min-date="minDate"
      @update:model-value="$emit('update:modelValue', $event)"
    />
  </div>
</template>

<script setup lang="ts">
export interface FilterDateRangeValue {
  from: string | null
  to: string | null
}

withDefaults(defineProps<{
  label?: string
  minDate?: string | null
  modelValue: FilterDateRangeValue
}>(), {
  label: '日期范围',
  minDate: null,
})

defineEmits<{
  'update:modelValue': [value: FilterDateRangeValue]
}>()
</script>
