<template>
  <div>
    <div class="flex items-center gap-1 mb-1.5">
      <label class="text-sm font-medium text-[var(--text-primary)]">{{ label }}</label>
      <span v-if="required" class="text-danger text-2xs">*</span>
    </div>
    <slot />
    <div v-if="hint || $slots.hint" class="text-2xs text-muted-deep mt-1">
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
