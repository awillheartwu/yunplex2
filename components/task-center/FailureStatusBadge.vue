<script setup lang="ts">
import type { FailureHandlingState } from '../../shared/failure-handling'
import { failureStatePresentation } from '../../lib/failure-presentation'

const props = defineProps<{ state: FailureHandlingState; details?: boolean }>()
const presentation = computed(() => failureStatePresentation(props.state))
</script>

<template>
  <div class="failure-state">
    <StatusBadge :status="presentation.badge" :label="`当前：${presentation.label}`" />
    <span v-if="details && presentation.description">{{ presentation.description }}</span>
  </div>
</template>

<style scoped>
.failure-state{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2)}
.failure-state>span:last-child:not(:first-child){color:var(--text-secondary);font-size:var(--text-xs)}
</style>
