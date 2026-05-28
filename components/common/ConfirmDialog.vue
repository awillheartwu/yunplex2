<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center"
      style="background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)"
      @click.self="onCancel"
    >
      <div class="section-card p-6 w-[420px] max-w-[90vw] shadow-lg" style="border-color:var(--border-secondary)">
        <h3 class="text-sm font-semibold mb-2">{{ title }}</h3>
        <p class="text-xs text-muted mb-6">{{ message }}</p>
        <div class="flex justify-end gap-3">
          <button v-if="showCancel" class="btn btn-secondary btn-sm" @click="onCancel">取消</button>
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
