<template>
  <span ref="trigger" class="action-hint" @pointerenter="open" @pointerleave="scheduleClose" @focusin="open" @focusout="scheduleClose" @click="close">
    <slot />
    <Teleport to="body">
      <div v-if="visible" :id="id" ref="tooltip" role="tooltip" class="action-hint__tip" :style="position" @pointerenter="cancelClose" @pointerleave="scheduleClose">{{ text }}</div>
    </Teleport>
  </span>
</template>
<script setup lang="ts">
import { useId, onUpdated, onBeforeUnmount } from 'vue'
const props = defineProps<{ text: string }>()
const id = `action-hint-${useId()}`
const trigger = ref<HTMLElement | null>(null), tooltip = ref<HTMLElement | null>(null)
const visible = ref(false), position = ref<Record<string, string>>({})
let timer: ReturnType<typeof setTimeout> | undefined
function cancelClose() { clearTimeout(timer) }
function close() { cancelClose(); visible.value = false }
function scheduleClose() { cancelClose(); timer = setTimeout(close, 120) }
async function open() {
  cancelClose()
  if (!props.text) return
  visible.value = true
  await nextTick()
  const anchor = trigger.value?.getBoundingClientRect(), tip = tooltip.value?.getBoundingClientRect()
  if (!anchor || !tip) return
  const gutter = 12, gap = 8
  const left = Math.max(gutter, Math.min(anchor.x + anchor.width / 2 - tip.width / 2, window.innerWidth - tip.width - gutter))
  const top = anchor.top >= tip.height + gutter + gap ? anchor.top - tip.height - gap : Math.min(anchor.bottom + gap, window.innerHeight - tip.height - gutter)
  position.value = { left: `${left}px`, top: `${Math.max(gutter, top)}px` }
}
function describe() {
  const control = trigger.value?.querySelector<HTMLElement>('button, a, input, select, summary')
  if (control) control.setAttribute('aria-describedby', [control.getAttribute('aria-describedby'), id].filter(Boolean).join(' ').split(' ').filter((value, index, values) => values.indexOf(value) === index).join(' '))
}
function onKey(event: KeyboardEvent) { if (event.key === 'Escape' && visible.value) { event.stopPropagation(); close() } }
onMounted(() => { describe(); document.addEventListener('keydown', onKey, true); window.addEventListener('resize', close); window.addEventListener('scroll', close, true) })
onUpdated(describe)
onBeforeUnmount(() => { cancelClose(); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) })
</script>
<style scoped>
.action-hint { display: inline-flex; min-width: 0; }
.action-hint__tip { position: fixed; z-index: var(--z-toast); max-width: min(22rem, calc(100vw - 1.5rem)); padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); background: var(--bg-tooltip); color: var(--on-tooltip); font-size: var(--text-sm); line-height: var(--body-leading); font-weight: var(--font-weight-normal); box-shadow: var(--shadow-md); overflow-wrap: anywhere; }
</style>
