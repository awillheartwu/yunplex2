<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="onCancel"
    >
      <div class="bg-surface-elevated border border-[var(--border-secondary)] rounded-xl p-8 w-[440px] shadow-2xl">
        <h3 class="text-base font-semibold mb-2">{{ title }}</h3>
        <p class="text-sm text-muted mb-6">{{ message }}</p>
        <div class="flex justify-end gap-4">
          <button v-if="showCancel" class="btn btn-secondary" @click="onCancel">取消</button>
          <button
            class="btn"
            :class="variant === 'danger' ? 'btn-danger' : 'btn-primary'"
            @click="onConfirm"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  visible: boolean
  title: string
  message: string
  confirmLabel?: string
  variant?: 'danger' | 'primary'
  showCancel?: boolean
}>(), {
  confirmLabel: '确认',
  variant: 'primary',
  showCancel: true,
})

const emit = defineEmits<{ confirm: []; cancel: [] }>()
function onConfirm() { emit('confirm') }
function onCancel() { emit('cancel') }
</script>
