<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="confirm-backdrop fixed inset-0 z-[var(--z-modal)] flex items-end justify-center p-4 sm:items-center"
      style="background:var(--bg-overlay);backdrop-filter:blur(8px)"
      @click.self="onCancel"
    >
      <div
        ref="panel"
        tabindex="-1"
        class="confirm-panel section-card w-full max-w-[28rem] p-5 shadow-lg sm:p-6"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        style="border-color:var(--border-secondary)"
      >
        <div class="mb-3 flex items-center gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            :style="variant === 'danger' ? 'background:var(--danger-soft);color:var(--danger)' : 'background:var(--accent-muted);color:var(--accent)'"
          >
            <AppIcon :name="variant === 'danger' ? 'warn' : 'info'" :size="20" />
          </div>
          <h3 class="text-sm font-semibold">{{ title }}</h3>
        </div>
        <div class="confirm-panel__content"><slot>
          <p class="mb-6 text-sm leading-6 text-muted">{{ message }}</p>
        </slot></div>
        <div class="confirm-panel__actions flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button v-if="showCancel" class="btn btn-secondary btn-sm" :disabled="busy" @click="onCancel">{{ cancelLabel }}</button>
          <button
            class="btn"
            :class="variant === 'danger' ? 'btn-danger' : 'btn-primary'"
            :disabled="busy || confirmDisabled"
            :aria-busy="busy"
            @click="onConfirm"
          >
            {{ busy ? '处理中…' : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useDialogFocus } from '~/composables/useDialogFocus'
const panel = ref<HTMLElement | null>(null)
const props = withDefaults(defineProps<{
  visible: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
  showCancel?: boolean
  busy?: boolean
  confirmDisabled?: boolean
}>(), {
  message: '',
  confirmLabel: '确认',
  cancelLabel: '取消',
  variant: 'primary',
  showCancel: true,
  busy: false,
  confirmDisabled: false,
})

const emit = defineEmits<{ confirm: []; cancel: [] }>()
function onConfirm() { if (!props.busy && !props.confirmDisabled) emit('confirm') }
function onCancel() { if (!props.busy) emit('cancel') }
useDialogFocus(() => props.visible, panel, onCancel)
</script>

<style scoped>
.confirm-panel{display:flex;flex-direction:column;max-height:calc(100dvh - 2rem);min-height:0}.confirm-panel__content{min-height:0;overflow:auto;overscroll-behavior:contain;overflow-wrap:anywhere}.confirm-panel__actions{flex:none;padding-top:var(--space-4)}.confirm-panel>div:first-child{flex:none}@media(max-width:767px){.confirm-backdrop{padding:var(--space-3);padding-bottom:max(.75rem,env(safe-area-inset-bottom))}.confirm-panel{max-height:calc(100dvh - 1.5rem)}}
</style>
