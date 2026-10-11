<script setup lang="ts">
import { useId } from 'vue'
import { useDialogFocus } from '~/composables/useDialogFocus'
const props = withDefaults(defineProps<{ visible: boolean; title: string; wide?: boolean; busy?: boolean }>(), { wide: false, busy: false })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
const titleId = `drawer-${useId()}`
function dismiss() { if (!props.busy) emit('close') }
useDialogFocus(() => props.visible, panel, dismiss)
</script>

<template>
  <Teleport to="body">
    <div v-show="visible" class="app-drawer-backdrop" @click.self="dismiss">
      <section ref="panel" tabindex="-1" class="app-drawer" :class="{ 'app-drawer--wide': wide }" role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-busy="busy">
        <header class="app-drawer__header"><h2 :id="titleId">{{ title }}</h2><button type="button" class="icon-button" :disabled="busy" :aria-label="`关闭${title}`" @click="dismiss"><AppIcon name="close" :size="18" /></button></header>
        <div class="app-drawer__body"><slot /></div>
        <footer v-if="$slots.footer" class="app-drawer__footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.app-drawer-backdrop { position: fixed; inset: 0; z-index: var(--z-drawer); display: flex; justify-content: flex-end; background: var(--bg-overlay); }
.app-drawer { display: flex; flex-direction: column; width: min(38rem, 100%); height: 100dvh; min-width: 0; background: var(--bg-surface); border-left: 1px solid var(--border-primary); box-shadow: var(--shadow-lg); }
.app-drawer--wide { width: min(64rem, 100%); }
.app-drawer__header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border-primary); }
.app-drawer__header h2 { margin: 0; }
.app-drawer__body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-5); }
.app-drawer__footer { flex: 0 0 auto; max-height: 45dvh; overflow-y: auto; padding: var(--space-4) var(--space-5); border-top: 1px solid var(--border-primary); background: var(--bg-surface); }
@media (max-width: 767px) {
  .app-drawer { width: 100%; }
  .app-drawer__body, .app-drawer__header { padding: var(--space-4); }
  .app-drawer__footer { padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom)); }
}
</style>
