<template>
  <div ref="field" class="form-field">
    <div class="form-field__label-row">
      <label :for="controlId" class="form-field__label">{{ label }}</label>
      <span v-if="required" class="form-field__required" aria-label="必填">*</span>
    </div>
    <slot />
    <div v-if="hint || $slots.hint" :id="hintId" class="form-field__hint">
      <slot name="hint">
        <p>{{ hint }}</p>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUpdated, useId } from 'vue'

const props = defineProps<{
  label: string
  hint?: string
  required?: boolean
}>()
const field = ref<HTMLElement | null>(null)
const generatedId = useId()
const controlId = ref(`${generatedId}-control`)
const hintId = `${generatedId}-hint`

// Slots can contain native controls or compound controls; label the first input
// without replacing caller-provided IDs or accessible descriptions.
function associateLabel() {
  const control = field.value?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')
  if (!control) return
  controlId.value = control.id || `${generatedId}-control`
  if (!control.id) control.id = controlId.value
  if (props.hint && !control.hasAttribute('aria-describedby')) control.setAttribute('aria-describedby', hintId)
}
onMounted(associateLabel)
onUpdated(associateLabel)
</script>

<style scoped>
.form-field {
  min-width: 0;
}

.form-field__label-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-1_5);
}

.form-field__label {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-bold);
}

.form-field__required {
  color: var(--danger);
  font-size: var(--text-xs);
}

.form-field__hint {
  margin-top: var(--space-1_5);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
}
</style>
