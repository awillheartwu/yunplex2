<template>
  <section class="section-card overflow-hidden">
    <div
      class="px-5 py-4 flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
      :class="!collapsed ? 'border-b border-[var(--border-primary)]' : 'border-b border-transparent'"
      @click="$emit('toggle')"
    >
      <div>
        <div class="flex items-center gap-2">
          <slot name="icon" />
          <h3 class="text-sm font-semibold">{{ title }}</h3>
        </div>
        <p class="text-2xs text-muted mt-0.5">{{ description }}</p>
      </div>
      <Chevron :open="!collapsed" />
    </div>
    <div v-show="!collapsed" class="p-5 space-y-4">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ title: string; description: string; collapsed: boolean }>()
defineEmits<{ toggle: [] }>()
</script>
