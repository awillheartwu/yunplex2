<template>
  <span class="run-type-badge" :class="`run-type-badge--${identity.tone}`">
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
.run-type-badge{display:inline-flex;min-height:2rem;align-items:center;gap:.45rem;padding:.22rem .7rem .22rem .35rem;border:1px solid;border-radius:999px;font-size:.75rem;font-weight:750;line-height:1}
.run-type-badge__icon{display:inline-flex;width:1.45rem;height:1.45rem;align-items:center;justify-content:center;border-radius:999px;background:color-mix(in srgb,currentColor 12%,transparent)}
.run-type-badge--sync{color:var(--run-sync);background:var(--run-sync-soft);border-color:var(--run-sync-border)}
.run-type-badge--download{color:var(--run-download);background:var(--run-download-soft);border-color:var(--run-download-border)}
.run-type-badge--repair{color:var(--run-repair);background:var(--run-repair-soft);border-color:var(--run-repair-border)}
</style>
