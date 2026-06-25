<template>
  <Teleport to="body">
    <div class="toast-region" :style="{ zIndex: OVERLAY_LAYERS.toast }" role="status" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast-card"
          :class="`toast-${toast.type}`"
        >
          <AppIcon :name="toastIcon(toast.type)" :size="17" />
          <div class="min-w-0 flex-1">
            <p class="toast-title">{{ toast.title }}</p>
            <p v-if="toast.message" class="toast-message">{{ toast.message }}</p>
          </div>
          <button class="icon-button h-8 w-8" type="button" aria-label="关闭提示" @click="dismiss(toast.id)">
            <AppIcon name="close" :size="15" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useFeedback } from '~~/composables/useFeedback'
import { OVERLAY_LAYERS } from '~~/lib/overlay-layers'

const { toasts, dismiss } = useFeedback()

function toastIcon(type: string): string {
  if (type === 'success') return 'check'
  if (type === 'error') return 'warn'
  if (type === 'warning') return 'alert'
  return 'info'
}
</script>
