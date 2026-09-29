<template>
  <span class="run-type-badge" :class="[`run-type-badge--${identity.tone}`, { 'run-type-badge--sm': size === 'sm' }]">
    <span class="run-type-badge__icon" aria-hidden="true">
      <AppIcon :name="identity.icon" :size="iconSize" />
    </span>
    <span>{{ compact ? identity.shortLabel : identity.label }}</span>
  </span>
</template>

<script setup lang="ts">
import type { TaskRunType } from '~~/server/lib/job/types'
import { runTypeIdentity } from '~~/lib/run-presentation'

const props = withDefaults(defineProps<{
  type: TaskRunType
  compact?: boolean
  size?: 'sm' | 'default'
}>(), {
  compact: false,
  size: 'default',
})

const identity = computed(() => runTypeIdentity(props.type))
const iconSize = computed(() => props.size === 'sm' ? 13 : 15)
</script>

<style scoped>
.run-type-badge{display:inline-flex;min-height:2rem;align-items:center;gap:var(--space-2);padding:var(--space-1) var(--space-3) var(--space-1) var(--space-1_5);border:1px solid;border-radius:var(--radius-sm);font-size:var(--text-xs);font-weight:var(--font-weight-medium);line-height:1}
.run-type-badge__icon{display:inline-flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);}
.run-type-badge--sync{color:var(--run-sync);background:var(--run-sync-soft);border-color:var(--run-sync-border)}
.run-type-badge--download{color:var(--run-download);background:var(--run-download-soft);border-color:var(--run-download-border)}
.run-type-badge--repair{color:var(--run-repair);background:var(--run-repair-soft);border-color:var(--run-repair-border)}
.run-type-badge--initialization{color:var(--run-sync);background:var(--run-sync-soft);border-color:var(--run-sync-border)}
.run-type-badge--sm{min-height:1.5rem;gap:var(--space-1);padding:var(--space-1) var(--space-1_5)}
</style>
