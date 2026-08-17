<template>
  <div class="form-field">
    <div class="form-field__label-row">
      <label class="form-field__label">{{ label }}</label>
      <span v-if="required" class="form-field__required" aria-label="必填">*</span>
    </div>
    <slot />
    <div v-if="hint || $slots.hint" class="form-field__hint">
      <slot name="hint">
        <p>{{ hint }}</p>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  hint?: string
  required?: boolean
}>()
</script>

<style scoped>
.form-field {
  min-width: 0;
}

.form-field__label-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.4rem;
}

.form-field__label {
  color: var(--text-primary);
  font-size: 0.8rem;
  font-weight: 700;
}

.form-field__required {
  color: var(--danger);
  font-size: 0.72rem;
}

.form-field__hint {
  margin-top: 0.35rem;
  color: var(--text-tertiary);
  font-size: 0.7rem;
  line-height: 1.5;
}
</style>
