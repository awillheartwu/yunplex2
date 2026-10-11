<template>
  <div
    ref="rootRef"
    class="list-select"
    :class="{ 'list-select--open': open, 'list-select--disabled': isDisabled }"
    @focusout="onFocusOut"
  >
    <span v-if="label" :id="labelId" class="list-select__label">{{ label }}</span>
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      class="list-select__trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open ? 'true' : 'false'"
      :data-value="modelValue"
      :aria-controls="panelId"
      :aria-activedescendant="activeDescendantId"
      :aria-labelledby="labelledBy"
      :aria-label="ariaLabel || undefined"
      :aria-busy="loading ? 'true' : undefined"
      :disabled="isDisabled"
      @click="togglePanel"
      @keydown="onTriggerKeydown"
    >
      <span class="list-select__value" :class="{ 'list-select__value--placeholder': !selectedOption }">
        {{ loading ? loadingText : selectedOption?.label ?? placeholder }}
      </span>
      <AppIcon
        :name="loading ? 'loader' : 'chevronDown'"
        :size="14"
        class="list-select__chevron"
        :class="{ 'animate-spin': loading, 'list-select__chevron--open': open }"
      />
    </button>

    <Transition name="popover">
      <div
        v-if="open"
        :id="panelId"
        ref="panelRef"
        class="list-select__panel"
        :style="panelStyle"
        role="listbox"
        :aria-labelledby="labelledBy"
        :aria-label="ariaLabel || undefined"
        @mousedown.prevent
      >
        <p v-if="!options.length" class="list-select__empty">{{ emptyText }}</p>
        <div
          v-for="(option, index) in options"
          :id="optionElementId(index)"
          :key="option.value"
          :data-value="option.value"
          class="list-select__option"
          :class="{ 'list-select__option--active': index === activeIndex, 'list-select__option--selected': option.value === modelValue }"
          role="option"
          :aria-selected="option.value === modelValue ? 'true' : 'false'"
          :aria-disabled="option.disabled ? 'true' : undefined"
          @click="commitOption(option)"
          @mousemove="setActive(index)"
        >
          <span class="list-select__option-body">
            <span class="list-select__option-label">{{ option.label }}</span>
            <small v-if="option.description" class="list-select__option-description">{{ option.description }}</small>
          </span>
          <AppIcon v-if="option.value === modelValue" name="check" :size="15" class="list-select__check" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useRafThrottleFn } from '~~/composables/useTiming'

interface ListSelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string
  options: readonly ListSelectOption[]
  ariaLabel?: string
  label?: string
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  loadingText?: string
  emptyText?: string
}>(), {
  ariaLabel: '',
  label: '',
  placeholder: '请选择',
  disabled: false,
  loading: false,
  loadingText: '加载中…',
  emptyText: '没有可选项目',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
  open: []
  close: []
}>()

// The panel is rendered in place and stays inside the owning dialog: a body portal would be
// pulled back by `useDialogFocus` whenever focus moved into it.
const uid = useId()
const triggerId = `${uid}-trigger`
const labelId = `${uid}-label`
const panelId = `${uid}-panel`
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const open = ref(false)
const activeIndex = ref(-1)
let typeahead = ''
let typeaheadTimer: ReturnType<typeof setTimeout> | undefined

const isDisabled = computed(() => Boolean(props.disabled || props.loading))
const selectedIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue))
const selectedOption = computed(() => (selectedIndex.value >= 0 ? props.options[selectedIndex.value] : null))
const labelledBy = computed(() => {
  if (props.ariaLabel) return undefined
  if (props.label) return labelId
  return undefined
})
const activeDescendantId = computed(() => (open.value && activeIndex.value >= 0 ? optionElementId(activeIndex.value) : undefined))

function optionElementId(index: number) { return `${uid}-option-${index}` }

function firstSelectable() { return props.options.findIndex(option => !option.disabled) }
function lastSelectable() {
  for (let index = props.options.length - 1; index >= 0; index -= 1) if (!props.options[index]?.disabled) return index
  return -1
}

function setActive(index: number) {
  if (index >= 0 && index < props.options.length && !props.options[index]?.disabled) activeIndex.value = index
}

function moveActive(step: 1 | -1) {
  const total = props.options.length
  if (!total) return
  let index = activeIndex.value
  if (index < 0) index = step > 0 ? -1 : 0
  for (let attempt = 0; attempt < total; attempt += 1) {
    index = (index + step + total) % total
    if (!props.options[index]?.disabled) { activeIndex.value = index; return }
  }
}

function openPanel(preferredIndex?: number) {
  if (isDisabled.value) return
  open.value = true
  const candidate = preferredIndex ?? selectedIndex.value
  setActive(candidate)
  if (activeIndex.value < 0) activeIndex.value = firstSelectable()
  emit('open')
  nextTick(() => { updatePanelPosition(); scrollActiveIntoView() })
}

function closePanel(refocus = false) {
  if (!open.value) return
  open.value = false
  typeahead = ''
  emit('close')
  if (refocus) triggerRef.value?.focus()
}

function togglePanel() {
  if (open.value) closePanel()
  else openPanel()
}

function commitOption(option: ListSelectOption) {
  if (option.disabled) return
  const changed = option.value !== props.modelValue
  closePanel(true)
  if (!changed) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
}

function scrollActiveIntoView() {
  const panel = panelRef.value
  if (!panel || activeIndex.value < 0) return
  const option = panel.children[activeIndex.value] as HTMLElement | undefined
  if (!option) return
  if (option.offsetTop < panel.scrollTop) panel.scrollTop = option.offsetTop
  else if (option.offsetTop + option.offsetHeight > panel.scrollTop + panel.clientHeight) panel.scrollTop = option.offsetTop + option.offsetHeight - panel.clientHeight
}

function runTypeahead(event: KeyboardEvent) {
  if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
  if (!open.value) openPanel()
  typeahead += event.key.toLocaleLowerCase()
  if (typeaheadTimer) clearTimeout(typeaheadTimer)
  typeaheadTimer = setTimeout(() => { typeahead = '' }, 600)
  const match = props.options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(typeahead))
  if (match >= 0) {
    activeIndex.value = match
    nextTick(scrollActiveIntoView)
  }
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (isDisabled.value) return
  const isSpace = event.key === ' ' || event.key === 'Spacebar'
  if (!open.value) {
    if (event.key === 'ArrowDown' || isSpace || event.key === 'Enter') { event.preventDefault(); openPanel(); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); openPanel(lastSelectable()); return }
    if (event.key === 'Home') { event.preventDefault(); openPanel(firstSelectable()); return }
    if (event.key === 'End') { event.preventDefault(); openPanel(lastSelectable()); return }
    runTypeahead(event)
    return
  }
  if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1) }
  else if (event.key === 'Home') { event.preventDefault(); setActive(firstSelectable()) }
  else if (event.key === 'End') { event.preventDefault(); setActive(lastSelectable()) }
  else if (event.key === 'Enter' || isSpace) {
    event.preventDefault()
    const option = props.options[activeIndex.value]
    if (option) commitOption(option)
    return
  } else if (event.key === 'Escape' || event.key === 'Esc') {
    event.preventDefault()
    event.stopPropagation()
    closePanel(true)
    return
  } else if (event.key === 'Tab') {
    closePanel()
    return
  } else runTypeahead(event)
  nextTick(scrollActiveIntoView)
}

// Escape is registered on `window` in the capture phase so an enclosing dialog's own document
// capture handler (see `useDialogFocus`) cannot close the whole dialog before the list closes.
function onWindowKeydown(event: KeyboardEvent) {
  if (!open.value || (event.key !== 'Escape' && event.key !== 'Esc')) return
  event.preventDefault()
  event.stopPropagation()
  closePanel(true)
}

function onDocumentPointerdown(event: Event) {
  const target = event.target
  if (target instanceof Node && rootRef.value?.contains(target)) return
  closePanel()
}

// Hiding the owner (for example a `v-show` drawer) drops focus to the body without a pointerdown.
function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && rootRef.value?.contains(next)) return
  closePanel()
}

function updatePanelPosition() {
  const root = rootRef.value
  const trigger = triggerRef.value
  const panel = panelRef.value
  if (!root || !trigger || !panel || typeof window === 'undefined') return
  const triggerRect = trigger.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  // An inline panel is clipped by the nearest scrolling ancestor (filter popovers and sheets),
  // so width and height are bounded by that box and the panel flips when there is more room above.
  const bounds = clipBounds(trigger)
  const gap = 6
  const spaceBelow = Math.max(0, bounds.bottom - triggerRect.bottom - gap)
  const spaceAbove = Math.max(0, triggerRect.top - bounds.top - gap)
  const openUpward = panel.scrollHeight > spaceBelow && spaceAbove > spaceBelow
  const available = openUpward ? spaceAbove : spaceBelow
  const width = panel.offsetWidth || triggerRect.width
  const rightLimit = Math.min(bounds.right, window.innerWidth) - gap
  const leftLimit = Math.max(bounds.left, 0) + gap
  const left = Math.min(Math.max(triggerRect.left, leftLimit), Math.max(leftLimit, rightLimit - width))
  panelStyle.value = {
    left: `${Math.round(left - rootRect.left)}px`,
    maxHeight: `${Math.round(Math.min(320, Math.max(0, available)))}px`,
    minWidth: `${Math.round(triggerRect.width)}px`,
    ...(openUpward
      ? { top: 'auto', bottom: `${Math.round(rootRect.bottom - triggerRect.top + gap)}px` }
      : { top: `${Math.round(triggerRect.bottom - rootRect.top + gap)}px`, bottom: 'auto' }),
  }
}

function clipBounds(node: HTMLElement) {
  const viewport = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
  let current = node.parentElement
  while (current && current !== document.body && current !== document.documentElement) {
    const style = getComputedStyle(current)
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
      const rect = current.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
    }
    current = current.parentElement
  }
  return viewport
}

const reposition = useRafThrottleFn(updatePanelPosition)
const scheduleReposition = () => reposition.run()

function detachListeners() {
  if (typeof window === 'undefined') return
  window.removeEventListener('keydown', onWindowKeydown, true)
  window.removeEventListener('resize', scheduleReposition)
  window.removeEventListener('scroll', scheduleReposition, true)
  document.removeEventListener('pointerdown', onDocumentPointerdown, true)
}

watch(open, value => {
  if (typeof window === 'undefined') return
  detachListeners()
  if (!value) return
  window.addEventListener('keydown', onWindowKeydown, true)
  window.addEventListener('resize', scheduleReposition)
  window.addEventListener('scroll', scheduleReposition, true)
  document.addEventListener('pointerdown', onDocumentPointerdown, true)
})

// A dialog parent can hide or remove this control while the panel is open; keep no stale state.
watch(isDisabled, value => { if (value) closePanel() })

onBeforeUnmount(() => {
  detachListeners()
  if (typeaheadTimer) clearTimeout(typeaheadTimer)
})

defineExpose({ open: () => openPanel(), close: () => closePanel() })
</script>
