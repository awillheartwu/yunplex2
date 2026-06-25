<template>
  <button
    type="button"
    class="filter-chip"
    :class="{ 'filter-chip-active': active }"
    :aria-pressed="active"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ active?: boolean }>(), { active: false })
</script>
