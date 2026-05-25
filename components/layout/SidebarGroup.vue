<template>
  <div>
    <button
      class="w-full flex items-center gap-1.5 px-2 py-1 text-2xs font-semibold uppercase tracking-wider cursor-pointer transition-colors duration-150 rounded hover:bg-[var(--bg-hover)]"
      :style="{ color: collapsed ? 'var(--text-tertiary)' : 'var(--text-secondary)' }"
      @click="collapsed = !collapsed"
    >
      <svg
        width="10" height="10" viewBox="0 0 10 10" fill="none"
        class="transition-transform duration-150 shrink-0"
        :class="collapsed ? '' : 'rotate-90'"
      >
        <path d="M3.5 2l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      {{ label }}
    </button>
    <div v-show="!collapsed" class="mt-0.5 space-y-px">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ label: string; defaultOpen?: boolean }>()
const collapsed = ref(!(props.defaultOpen ?? true))
</script>
