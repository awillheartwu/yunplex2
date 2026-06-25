<template>
  <div>
    <button
      v-show="!collapsed"
      class="w-full flex items-center gap-1.5 px-2 py-1 text-2xs font-semibold uppercase tracking-wider cursor-pointer transition-colors duration-150 rounded hover:bg-[var(--bg-hover)]"
      :style="{ color: groupCollapsed ? 'var(--text-tertiary)' : 'var(--text-secondary)' }"
      @click="groupCollapsed = !groupCollapsed"
    >
      <AppIcon name="chevronRight" :size="10" class="transition-transform duration-150 shrink-0" :class="groupCollapsed ? '' : 'rotate-90'" />
      {{ label }}
    </button>
    <div v-show="collapsed || !groupCollapsed" class="mt-0.5 space-y-px">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; defaultOpen?: boolean; collapsed?: boolean }>()
const groupCollapsed = ref(false)
</script>
