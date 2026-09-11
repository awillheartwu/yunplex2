<template>
  <div class="source-boolean-override">
    <div class="source-boolean-override__copy">
      <span class="source-boolean-override__label">{{ label }}</span>
      <p class="source-boolean-override__hint">
        <template v-if="hint">{{ hint }} · </template>设置效果：{{ effectiveValue === null ? '尚未读取全局设置' : effectiveValue ? '开启' : '关闭' }}
      </p>
    </div>
    <select
      :value="serializedValue"
      class="form-input source-boolean-override__select"
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
  globalValue: boolean | null
  label: string
  hint?: string
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

<style scoped>
.source-boolean-override {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 8.5rem;
  gap: var(--space-4);
  align-items: center;
  width: 100%;
  min-width: 0;
}

.source-boolean-override__copy {
  min-width: 0;
}

.source-boolean-override__label {
  display: block;
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 1.4;
}

.source-boolean-override__hint {
  margin-top: var(--space-0_5);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: 1.45;
}

.source-boolean-override__select {
  width: 8.5rem;
  min-width: 0;
  font-size: var(--text-xs);
}

@media (max-width: 480px) {
  .source-boolean-override {
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }

  .source-boolean-override__select {
    width: 100%;
  }
}
</style>
