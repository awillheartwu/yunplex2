<template>
  <div class="flex items-center justify-between py-1">
    <div>
      <p class="text-sm text-[var(--text-primary)]">{{ label }}</p>
      <p v-if="hint" class="text-2xs text-muted-deep mt-0.5">{{ hint }}</p>
    </div>
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      class="relative w-9 h-5 rounded-full transition-colors cursor-pointer"
      :class="modelValue ? 'bg-accent' : 'bg-[#2a2a2a]'"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span
        class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
        :class="modelValue ? 'left-[18px]' : 'left-0.5'"
      />
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
