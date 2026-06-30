<template>
  <div class="flex h-dvh overflow-hidden" style="background:var(--bg-app);color:var(--text-primary)">
    <Sidebar id="app-sidebar" class="hidden md:flex" />

    <Transition name="sheet">
      <div
        v-if="mobileNavOpen"
        id="mobile-navigation"
        class="fixed inset-0 z-[60] md:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="移动端导航"
        style="background:var(--bg-overlay);backdrop-filter:blur(8px)"
        @click.self="mobileNavOpen = false"
      >
        <Sidebar mobile class="h-full max-w-[18rem]" @navigate="mobileNavOpen = false" />
      </div>
    </Transition>

    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar
        :menu-open="topBarMenuOpen"
        :menu-mode="isDesktopViewport ? 'desktop' : 'mobile'"
        @toggle-menu="toggleNavigation"
      />
      <main class="flex-1 overflow-auto px-4 py-5 sm:px-6 md:px-8 md:py-7 xl:px-10">
        <div class="w-full">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSidebarState } from '~/composables/useSidebarState'

const mobileNavOpen = ref(false)
const isDesktopViewport = ref(false)
const { sidebarCollapsed, loadSidebarState, toggleSidebarCollapsed } = useSidebarState()

let desktopMediaQuery: MediaQueryList | undefined

const topBarMenuOpen = computed(() => {
  return isDesktopViewport.value ? !sidebarCollapsed.value : mobileNavOpen.value
})

function syncNavigationViewport() {
  if (!desktopMediaQuery) return
  isDesktopViewport.value = desktopMediaQuery.matches
  if (isDesktopViewport.value) mobileNavOpen.value = false
}

function toggleNavigation() {
  if (isDesktopViewport.value) {
    toggleSidebarCollapsed()
    return
  }
  mobileNavOpen.value = !mobileNavOpen.value
}

function closeMobileNavigation(event: KeyboardEvent) {
  if (event.key === 'Escape') mobileNavOpen.value = false
}

onMounted(() => {
  loadSidebarState()
  desktopMediaQuery = window.matchMedia('(min-width: 768px)')
  syncNavigationViewport()
  desktopMediaQuery.addEventListener('change', syncNavigationViewport)
  window.addEventListener('keydown', closeMobileNavigation)
})

onUnmounted(() => {
  desktopMediaQuery?.removeEventListener('change', syncNavigationViewport)
  window.removeEventListener('keydown', closeMobileNavigation)
})
</script>
