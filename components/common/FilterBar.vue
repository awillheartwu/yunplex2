<template>
  <section class="filter-shell" :class="{ 'filter-shell--advanced': advanced }">
    <div class="filter-row">
      <div class="filter-search">
        <AppIcon name="search" :size="16" />
        <input
          :value="search"
          type="search"
          class="filter-search-input"
          :placeholder="placeholder"
          :aria-label="searchLabel"
          @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
        >
      </div>

      <div v-if="$slots.primary" class="filter-primary">
        <slot name="primary" />
      </div>

      <div v-if="!advanced" class="filter-desktop">
        <slot name="filters" />
      </div>

      <div class="filter-actions" :class="{ 'filter-actions--advanced': advanced }">
        <button
          v-if="advanced"
          ref="advancedButtonRef"
          class="btn btn-secondary btn-xs filter-advanced-button"
          :class="activeCount > 0 ? 'filter-advanced-button--active' : ''"
          type="button"
          :aria-expanded="mobileOpen"
          aria-haspopup="dialog"
          @click="openPanel"
        >
          <AppIcon name="filter" :size="14" />
          {{ advancedLabel }}
          <span v-if="activeCount > 0" class="filter-advanced-button__badge">{{ activeCount }}</span>
        </button>
        <button
          v-else
          class="btn btn-secondary btn-xs md:hidden"
          type="button"
          :aria-expanded="mobileOpen"
          @click="mobileOpen = true"
        >
          <AppIcon name="filter" :size="14" />
          筛选
          <span v-if="activeCount > 0" class="filter-count">{{ activeCount }}</span>
        </button>
        <button v-if="canClear && !advanced" class="btn btn-ghost btn-xs" type="button" @click="$emit('clear')">清除</button>
        <slot name="actions" />
      </div>
    </div>

    <div v-if="advanced && canClear" class="filter-active-row">
      <div v-if="$slots['active-filters']" class="filter-active-list" aria-label="当前筛选条件">
        <slot name="active-filters" />
      </div>
      <button v-if="canClear" class="btn btn-ghost btn-xs filter-clear-button" type="button" @click="$emit('clear')">清除全部</button>
    </div>

    <slot name="batch" />
    <slot name="summary" />

    <Transition name="fade">
      <div
        v-if="advanced && mobileOpen"
        class="filter-popover-scrim hidden md:block"
        :style="{ zIndex: OVERLAY_LAYERS.filterScrim }"
        @click="closePanel"
      />
    </Transition>

    <Transition name="popover">
      <div
        v-if="advanced && mobileOpen"
        ref="advancedPanelRef"
        class="filter-popover hidden md:block"
        :style="{ ...popoverStyle, zIndex: OVERLAY_LAYERS.filterPopover }"
        role="dialog"
        aria-modal="false"
        aria-label="筛选条件"
      >
        <div class="filter-popover__header">
          <h3 class="text-sm font-semibold">{{ advancedTitle }}</h3>
          <button class="icon-button h-9 w-9" type="button" aria-label="关闭筛选" @click="closePanel">
            <AppIcon name="close" :size="16" />
          </button>
        </div>
        <div class="filter-popover__controls">
          <slot name="advanced" />
        </div>
        <div class="filter-popover__footer">
          <slot v-if="$slots['advanced-footer']" name="advanced-footer" :close="closePanel" />
          <template v-else>
            <button v-if="canClear" class="btn btn-secondary" type="button" @click="$emit('clear')">清除筛选</button>
            <button class="btn btn-primary" type="button" @click="closePanel">完成</button>
          </template>
        </div>
      </div>
    </Transition>

    <Teleport to="body">
      <Transition name="sheet">
        <div
          v-if="mobileOpen && (!advanced || isMobileViewport)"
          class="sheet-backdrop"
          :class="{ 'md:hidden': !advanced, 'filter-panel-backdrop': advanced }"
          :style="{ zIndex: OVERLAY_LAYERS.filterSheet }"
          @click.self="closePanel"
        >
          <div class="filter-sheet" role="dialog" aria-modal="true" aria-label="筛选条件">
            <div class="sheet-handle" />
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold">{{ advancedTitle }}</h3>
              <button class="icon-button h-9 w-9" type="button" aria-label="关闭筛选" @click="closePanel">
                <AppIcon name="close" :size="16" />
              </button>
            </div>
            <div v-if="!advanced" class="filter-search mt-3">
              <AppIcon name="search" :size="16" />
              <input
                :value="search"
                type="search"
                class="filter-search-input"
                :placeholder="placeholder"
                :aria-label="searchLabel"
                @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
              >
            </div>
            <div class="filter-sheet-controls">
              <slot v-if="advanced && $slots.advanced" name="advanced" />
              <slot v-else name="filters" />
            </div>
            <div class="filter-sheet-footer">
              <slot v-if="$slots['advanced-footer']" name="advanced-footer" :close="closePanel" />
              <template v-else>
                <button v-if="canClear" class="btn btn-secondary" type="button" @click="$emit('clear')">清除筛选</button>
                <button class="btn btn-primary" type="button" @click="closePanel">完成</button>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { OVERLAY_LAYERS } from '~~/lib/overlay-layers'
import { useRafThrottleFn } from '~~/composables/useTiming'

const props = withDefaults(defineProps<{
  search: string
  placeholder?: string
  searchLabel?: string
  activeCount?: number
  canClear?: boolean
  advanced?: boolean
  advancedLabel?: string
  advancedTitle?: string
}>(), {
  placeholder: '搜索...',
  searchLabel: '搜索',
  activeCount: 0,
  canClear: false,
  advanced: false,
  advancedLabel: '高级筛选',
  advancedTitle: '筛选',
})

const mobileOpen = ref(false)
const isMobileViewport = ref(false)
const advancedButtonRef = ref<HTMLElement | null>(null)
const advancedPanelRef = ref<HTMLElement | null>(null)
const popoverStyle = ref<Record<string, string>>({})
const emit = defineEmits<{
  'update:search': [value: string]
  clear: []
  'advanced-open': []
}>()

function openPanel() {
  emit('advanced-open')
  mobileOpen.value = true
  nextTick(() => updatePopoverPosition())
}

function closePanel() {
  mobileOpen.value = false
}

function syncViewportMode() {
  if (typeof window === 'undefined') return
  isMobileViewport.value = window.innerWidth < 768
}

function updatePopoverPosition() {
  if (typeof window === 'undefined' || isMobileViewport.value) return
  const trigger = advancedButtonRef.value
  const panel = advancedPanelRef.value
  if (!trigger || !panel) return

  const triggerRect = trigger.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const panelWidth = panel.offsetWidth || 360
  const gutter = 16
  const preferredLeft = triggerRect.right - panelWidth
  const left = Math.min(Math.max(gutter, preferredLeft), viewportWidth - panelWidth - gutter)
  const top = triggerRect.bottom + 10

  popoverStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  }
}

function handleWindowChange() {
  syncViewportMode()
  if (mobileOpen.value && props.advanced && !isMobileViewport.value) {
    nextTick(() => updatePopoverPosition())
  }
}

const windowChangeThrottle = useRafThrottleFn(handleWindowChange)
const handleWindowChangeOnFrame = () => windowChangeThrottle.run()

onMounted(() => {
  syncViewportMode()
  window.addEventListener('resize', handleWindowChangeOnFrame)
  window.addEventListener('scroll', handleWindowChangeOnFrame, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowChangeOnFrame)
  window.removeEventListener('scroll', handleWindowChangeOnFrame, true)
})
</script>
