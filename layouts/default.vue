<template>
  <div class="flex h-dvh overflow-hidden" style="background:var(--bg-app);color:var(--text-primary)">
    <Sidebar class="hidden md:flex" />

    <Transition name="sheet">
      <div v-if="mobileNavOpen" class="fixed inset-0 z-[60] md:hidden" style="background:var(--bg-overlay);backdrop-filter:blur(8px)" @click.self="mobileNavOpen = false">
        <Sidebar mobile class="h-full max-w-[18rem]" @navigate="mobileNavOpen = false" />
      </div>
    </Transition>

    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar @toggle-menu="mobileNavOpen = true" />
      <main class="flex-1 overflow-auto px-4 py-5 sm:px-6 md:px-8 md:py-7 xl:px-10">
        <div class="w-full">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const mobileNavOpen = ref(false)
</script>
