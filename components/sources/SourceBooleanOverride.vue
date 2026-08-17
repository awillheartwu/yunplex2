<template>
  <div class="flex items-center justify-between gap-4">
    <div class="min-w-0">
      <label class="text-xs font-medium" style="color:var(--text-primary)">{{ label }}</label>
      <p class="mt-0.5 text-2xs" style="color:var(--text-tertiary)">
        {{ hint }}。当前生效：{{ effectiveValue ? '开启' : '关闭' }}
      </p>
    </div>
    <select
      :value="serializedValue"
      class="form-input w-28 shrink-0 text-xs"
      :aria-label="label"
      @change="updateValue"
    >
      <option value="inherit">继承全局</option>
      <option value="true">开启</option>
      <option value="false">关闭</option>
    </select>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean | null
  globalValue: boolean
  label: string
  hint: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean | null] }>()

const serializedValue = computed(() =>
  props.modelValue === null ? 'inherit' : String(props.modelValue),
)
const effectiveValue = computed(() => props.modelValue ?? props.globalValue)

function updateValue(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update:modelValue', value === 'inherit' ? null : value === 'true')
}
</script>
