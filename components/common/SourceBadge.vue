<template>
  <span :class="badgeClass">{{ badgeText }}</span>
</template>

<script setup lang="ts">
import type { SourceType } from '~~/server/lib/playlist/types'

const props = defineProps<{ type: SourceType; subscribed?: boolean }>()

const badgeText = computed(() => {
  if (props.type === 'album') return '专辑'
  return props.subscribed ? '收藏' : '自建'
})

const badgeClass = computed(() => {
  const base = 'text-2xs px-1.5 py-0.5 rounded shrink-0'
  if (props.type === 'album') return `${base} bg-[#f59e0b20] text-[var(--warning,#f59e0b)]`
  return props.subscribed ? `${base} bg-[#22c55e20] text-success` : `${base} bg-[var(--accent-glow)] text-[var(--accent)]`
})
</script>
