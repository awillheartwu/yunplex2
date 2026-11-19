<template>
  <ProcessTimeline :items="items" aria-label="运行过程摘要" />
</template>

<script setup lang="ts">
import type { RunTimelineItem } from '~~/lib/run-timeline'

defineProps<{ items: RunTimelineItem[] }>()
</script>
