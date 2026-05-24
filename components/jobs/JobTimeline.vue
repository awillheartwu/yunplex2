<template>
  <div class="relative">
    <div v-for="(step, idx) in steps" :key="step.id" class="relative">
      <!-- Connector line -->
      <div
        v-if="idx < steps.length - 1"
        class="absolute left-[11px] top-8 w-px h-[calc(100%-16px)]"
        :class="step.status === 'success' ? 'bg-[#2a2a2a]' : 'bg-[#1f1f1f]'"
      />

      <div class="flex gap-3 pb-4">
        <!-- Dot -->
        <div class="relative shrink-0 mt-1">
          <div
            class="w-[22px] h-[22px] rounded-full flex items-center justify-center border"
            :class="dotClass(step.status)"
          >
            <svg v-if="step.status === 'success'" width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" :stroke="dotColor(step.status)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg v-else-if="step.status === 'failed'" width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" :stroke="dotColor(step.status)" stroke-width="2" stroke-linecap="round"/></svg>
            <svg v-else-if="step.status === 'running'" width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="4" :stroke="dotColor(step.status)" stroke-width="2" class="animate-pulse"/></svg>
            <div v-else class="w-[6px] h-[6px] rounded-full" :class="dotColor(step.status)" />
          </div>
        </div>

        <!-- Content -->
        <div class="flex-1 min-w-0 pt-0.5">
          <div class="flex items-center gap-2">
            <p class="text-sm" :class="step.status === 'failed' ? 'text-danger' : step.status === 'success' ? 'text-[var(--text-primary)]' : 'text-muted'">
              {{ step.title }}
            </p>
            <span v-if="step.durationMs > 0" class="text-2xs text-muted-deep">{{ formatMs(step.durationMs) }}</span>
          </div>
          <p v-if="step.message" class="text-2xs text-muted mt-0.5">{{ step.message }}</p>

          <!-- Child steps -->
          <div v-if="step.children.length > 0" class="mt-3 pl-4 border-l border-[var(--border-primary)] space-y-2">
            <div v-for="child in step.children" :key="child.id" class="flex items-start gap-2">
              <div
                class="w-[14px] h-[14px] rounded-full flex items-center justify-center shrink-0 mt-0.5"
                :class="dotClass(child.status)"
              >
                <svg v-if="child.status === 'success'" width="7" height="7" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" :stroke="dotColor(child.status)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <svg v-else-if="child.status === 'failed'" width="7" height="7" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" :stroke="dotColor(child.status)" stroke-width="2" stroke-linecap="round"/></svg>
              </div>
              <div>
                <p class="text-sm" :class="child.status === 'failed' ? 'text-danger' : 'text-muted'">{{ child.title }}</p>
                <p v-if="child.message" class="text-2xs text-muted-deep mt-0.5">{{ child.message }}</p>
              </div>
            </div>
          </div>

          <!-- Error detail -->
          <ErrorPanel v-if="step.error" :error="step.error" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { JobStep } from '~~/server/lib/job/types'

defineProps<{ steps: JobStep[] }>()

function dotClass(status: string): string {
  switch (status) {
    case 'success': return 'border-success'
    case 'failed': return 'border-danger'
    case 'running': return 'border-accent'
    case 'skipped': case 'cancelled': return 'border-[var(--text-tertiary)]'
    default: return 'border-[var(--border-secondary)]'
  }
}

function dotColor(status: string): string {
  switch (status) {
    case 'success': return '#2ecc71'
    case 'failed': return '#e74c3c'
    case 'running': return '#5e6ad2'
    default: return '#4a4a4a'
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
</script>
