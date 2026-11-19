import { nextTick, onBeforeUnmount, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

// A nested confirmation must not release another open dialog's scroll lock.
const openDialogs: symbol[] = []
let previousOverflow = ''

export function useDialogFocus(
  visible: MaybeRefOrGetter<boolean>,
  panel: Ref<HTMLElement | null>,
  dismiss: () => void,
) {
  const token = Symbol('dialog')
  let active = false
  let returnFocus: HTMLElement | null = null
  let generation = 0

  function controls() {
    return [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]') ?? [])]
      .filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0 && !node.closest('[inert]'))
  }

  function onFocusIn(event: FocusEvent) {
    if (!active || openDialogs.at(-1) !== token || !panel.value) return
    const target = event.target
    if (!(target instanceof Element) || panel.value.contains(target)) return
    ;(controls()[0] || panel.value).focus()
  }

  function onKeydown(event: KeyboardEvent) {
    if (!active || openDialogs.at(-1) !== token || !panel.value) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return }
    if (event.key !== 'Tab') return
    const nodes = controls(), first = nodes[0], last = nodes.at(-1)
    if (!first) { event.preventDefault(); panel.value.focus(); return }
    if (!panel.value.contains(document.activeElement) || document.activeElement === panel.value) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  function release() {
    generation++
    if (!active) return
    active = false
    const wasTop = openDialogs.at(-1) === token
    const index = openDialogs.indexOf(token)
    if (index >= 0) openDialogs.splice(index, 1)
    if (openDialogs.length === 0) document.body.style.overflow = previousOverflow
    document.removeEventListener('keydown', onKeydown, true)
    document.removeEventListener('focusin', onFocusIn, true)
    if (wasTop && returnFocus?.isConnected) returnFocus.focus()
  }

  watch(() => toValue(visible), async value => {
    if (typeof document === 'undefined') return
    if (!value) { release(); return }
    if (active) return
    active = true
    returnFocus = document.activeElement as HTMLElement | null
    if (!openDialogs.length) previousOverflow = document.body.style.overflow
    openDialogs.push(token)
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeydown, true)
    document.addEventListener('focusin', onFocusIn, true)
    const current = ++generation
    await nextTick()
    if (active && current === generation) (controls()[0] || panel.value)?.focus()
  }, { immediate: true, flush: 'post' })
  watch(panel, async () => {
    await nextTick()
    if (active && openDialogs.at(-1) === token && panel.value && !panel.value.contains(document.activeElement)) (controls()[0] || panel.value).focus()
  }, { flush: 'post' })
  onBeforeUnmount(release)
}
