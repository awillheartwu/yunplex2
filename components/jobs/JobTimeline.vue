<template>
  <div class="timeline">
    <div v-for="(step, idx) in steps" :key="step.id" class="timeline-step" :class="{ 'is-last': idx === steps.length - 1 }">
      <!-- Dot on the line -->
      <div class="timeline-dot" :class="dotClass(step.status)">
        <svg v-if="step.status === 'success'" width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" :stroke="dotColor(step.status)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <svg v-else-if="step.status === 'failed'" width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" :stroke="dotColor(step.status)" stroke-width="2" stroke-linecap="round"/></svg>
        <svg v-else-if="step.status === 'running'" width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="4" :stroke="dotColor(step.status)" stroke-width="2" class="animate-pulse"/></svg>
        <div v-else class="timeline-dot-empty" />
      </div>

      <!-- Content -->
      <div class="timeline-content">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="text-sm font-medium" :style="{ color: step.status === 'failed' ? 'var(--danger,#ef4444)' : 'var(--text-primary)' }">
            {{ step.title }}
          </p>
          <span v-if="step.durationMs > 0" class="text-2xs font-mono" style="color:var(--text-tertiary)">{{ formatMs(step.durationMs) }}</span>
          <span
            v-if="step.status"
            class="text-2xs px-1.5 py-0.5 rounded-full font-medium"
            :class="badgeClass(step.status)"
          >{{ statusLabel(step.status) }}</span>
        </div>
        <p v-if="step.message" class="text-2xs mt-1" style="color:var(--text-secondary)">{{ step.message }}</p>

        <!-- Child steps -->
        <div v-if="step.children.length > 0" class="mt-3 pl-5 space-y-2 border-l" style="border-color:var(--border-primary)">
          <div v-for="child in step.children" :key="child.id" class="flex items-start gap-2 relative">
            <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1" :class="childDotBg(child.status)" />
            <div>
              <p class="text-xs" style="color:var(--text-secondary)">{{ child.title }}</p>
              <p v-if="child.message" class="text-2xs mt-0.5" style="color:var(--text-tertiary)">{{ child.message }}</p>
            </div>
          </div>
        </div>

        <!-- Error -->
        <ErrorPanel v-if="step.error" :error="step.error" class="mt-3" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { JobStep } from '~~/server/lib/job/types'

defineProps<{ steps: JobStep[] }>()

function dotClass(status: string): string {
  switch (status) {
    case 'success': return 'dot-success'
    case 'failed': return 'dot-failed'
    case 'running': return 'dot-running'
    case 'skipped': case 'cancelled': return 'dot-skipped'
    default: return 'dot-pending'
  }
}
function childDotBg(status: string): string {
  switch (status) {
    case 'success': return 'bg-success'
    case 'failed': return 'bg-danger'
    case 'running': return 'bg-accent'
    default: return 'bg-[var(--border-secondary)]'
  }
}
function dotColor(status: string): string {
  switch (status) {
    case 'success': return '#22c55e'
    case 'failed': return '#ef4444'
    case 'running': return '#818cf8'
    default: return '#71717a'
  }
}
function badgeClass(status: string): string {
  switch (status) {
    case 'success': return 'bg-[#2ecc7120] text-success'
    case 'failed': return 'bg-[#e74c3c20] text-danger'
    case 'running': return 'bg-[#818cf820] text-accent animate-pulse'
    case 'skipped': case 'cancelled': return 'bg-[#71717a20] text-muted-deep'
    default: return 'bg-[#71717a10] text-muted-deep'
  }
}
function statusLabel(status: string): string {
  switch (status) {
    case 'success': return '完成'
    case 'failed': return '失败'
    case 'running': return '进行中'
    case 'skipped': return '跳过'
    case 'cancelled': return '取消'
    default: return '等待'
  }
}
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
</script>

<style scoped>
.timeline {
  position: relative;
}
.timeline-step {
  display: flex;
  gap: 14px;
  padding-bottom: 20px;
  position: relative;
}
.timeline-step:not(.is-last)::before {
  content: '';
  position: absolute;
  left: 12px;
  top: 28px;
  bottom: 0;
  width: 2px;
  background: var(--border-primary);
  border-radius: 1px;
}
.timeline-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
  border: 2px solid var(--border-secondary);
  background: var(--bg-surface);
  position: relative;
  z-index: 1;
}
.timeline-dot.dot-success {
  border-color: var(--success, #22c55e);
  background: var(--bg-surface);
}
.timeline-dot.dot-failed {
  border-color: var(--danger, #ef4444);
}
.timeline-dot.dot-running {
  border-color: var(--accent, #818cf8);
}
.timeline-dot.dot-skipped {
  border-color: var(--text-tertiary);
  opacity: 0.5;
}
.timeline-dot.dot-pending {
  border-color: var(--border-secondary);
}
.timeline-dot-empty {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-secondary);
}
.timeline-content {
  flex: 1;
  min-width: 0;
  padding-top: 3px;
}
</style>
