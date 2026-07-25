<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      style="background:var(--bg-overlay);backdrop-filter:blur(8px)"
      @click.self="onCancel"
    >
      <div
        class="section-card w-full max-w-[28rem] p-5 shadow-lg sm:p-6"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        style="border-color:var(--border-secondary)"
        @keydown.esc="onCancel"
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
        <slot>
          <p class="mb-6 text-sm leading-6 text-muted">{{ message }}</p>
        </slot>
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button v-if="showCancel" class="btn btn-secondary btn-sm" :disabled="busy" @click="onCancel">取消</button>
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
const props = withDefaults(defineProps<{
  visible: boolean
  title: string
  message?: string
  confirmLabel?: string
  variant?: 'danger' | 'primary'
  showCancel?: boolean
  busy?: boolean
  confirmDisabled?: boolean
}>(), {
  message: '',
  confirmLabel: '确认',
  variant: 'primary',
  showCancel: true,
  busy: false,
  confirmDisabled: false,
})

const emit = defineEmits<{ confirm: []; cancel: [] }>()
function onConfirm() { if (!props.busy && !props.confirmDisabled) emit('confirm') }
function onCancel() { if (!props.busy) emit('cancel') }
</script>
