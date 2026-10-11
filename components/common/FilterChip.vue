<template>
  <button
    type="button"
    class="filter-chip"
    :class="{ 'filter-chip-active': active }"
    :aria-pressed="active"
    :disabled="disabled"
  >
    <AppIcon v-if="check && active" name="check" :size="13" class="filter-chip__check" />
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  active?: boolean
  // Checkbox-like multi choice: the check mark states the on/off value without a native box.
  check?: boolean
  disabled?: boolean
}>(), {
  active: false,
  check: false,
  disabled: false,
})
</script>
