<template>
  <div class="app-shell flex overflow-x-hidden" :style="shellStyle">
    <a href="#main-content" class="skip-link">跳转到主要内容</a>
    <Sidebar id="app-sidebar" class="app-sidebar hidden md:flex" />

    <Transition name="sheet">
      <div
        v-if="mobileNavOpen"
        id="mobile-navigation"
        ref="mobileNavigation"
        class="fixed inset-0 z-[var(--z-drawer)] md:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="移动端导航"
        tabindex="-1"
        style="background:var(--bg-overlay);backdrop-filter:blur(8px)"
        @click.self="mobileNavOpen = false"
      >
        <Sidebar mobile class="min-h-full max-w-[18rem]" @navigate="mobileNavOpen = false" />
        <button class="mobile-nav-close icon-button" type="button" aria-label="关闭导航" @click="mobileNavOpen = false"><AppIcon name="close" :size="20" /></button>
      </div>
    </Transition>

    <div class="app-content flex min-w-0 flex-1 flex-col" :inert="mobileNavOpen || undefined">
      <TopBar
        :menu-open="topBarMenuOpen"
        :menu-mode="isDesktopViewport ? 'desktop' : 'mobile'"
        @toggle-menu="toggleNavigation"
      />
      <main id="main-content" tabindex="-1" class="app-main flex-1 px-4 py-5 sm:px-6 md:px-7 md:py-8 xl:px-8">
        <div
          class="app-page-frame w-full min-w-0"
          :class="{ 'app-page-frame--dashboard': route.path === '/' }"
        >
          <slot />
        </div>
      </main>
      <MobileDock />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useHead } from '#imports'
import { pageContext } from '~/lib/navigation'
import { useSidebarState } from '~/composables/useSidebarState'
import { useDialogFocus } from '~/composables/useDialogFocus'

const route = useRoute()
useHead(() => ({ title: `${pageContext(route.path).title} · reYunPlex` }))
const mobileNavOpen = ref(false)
const mobileNavigation = ref<HTMLElement | null>(null)
useDialogFocus(mobileNavOpen, mobileNavigation, () => { mobileNavOpen.value = false })
const isDesktopViewport = ref(false)
const { sidebarCollapsed, loadSidebarState, toggleSidebarCollapsed } = useSidebarState()

let desktopMediaQuery: MediaQueryList | undefined

const sidebarInlineSize = computed(() => sidebarCollapsed.value ? '64px' : '232px')

const shellStyle = computed(() => ({
  background: 'var(--bg-app)',
  color: 'var(--text-primary)',
  '--app-sidebar-inline-size': sidebarInlineSize.value,
}))

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

watch(() => route.path, () => { mobileNavOpen.value = false })

onMounted(() => {
  loadSidebarState()
  desktopMediaQuery = window.matchMedia('(min-width: 768px)')
  syncNavigationViewport()
  desktopMediaQuery.addEventListener('change', syncNavigationViewport)
})

onUnmounted(() => {
  desktopMediaQuery?.removeEventListener('change', syncNavigationViewport)
})
</script>

<style scoped>
@media(max-width:767px){.app-main{padding-bottom:calc(var(--mobile-dock-space) + var(--space-6))}}
.skip-link { position: fixed; top: .5rem; left: 1rem; z-index: var(--z-toast); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--accent); color: var(--on-accent); transform: translateY(-200%); }
.skip-link:focus { transform: translateY(0); }
.mobile-nav-close { position: absolute; right: .75rem; top: .65rem; background: var(--bg-surface); color: var(--text-primary); }
.app-page-frame {
  max-width: var(--app-content-max-width);
  margin-inline: auto;
}

.app-page-frame--dashboard {
  max-width: var(--dashboard-content-max-width);
}
</style>

<style scoped>
@media (min-width: 768px) {
  .app-sidebar {
    position: fixed;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: var(--z-sticky);
    block-size: 100dvh;
    max-block-size: 100dvh;
  }

  .app-content {
    min-block-size: var(--app-shell-min-block-size);
    padding-inline-start: var(--app-sidebar-inline-size);
  }
}
</style>
