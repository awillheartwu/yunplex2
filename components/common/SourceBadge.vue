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
  if (props.type === 'album') return `${base} semantic-ignored`
  return props.subscribed ? `${base} semantic-success` : `${base} bg-accent-muted text-accent`
})
</script>
