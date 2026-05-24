<template>
  <div class="flex h-screen bg-[var(--bg-app)] text-[var(--text-primary)] overflow-hidden">
    <Sidebar />
    <div class="flex-1 flex flex-col min-w-0">
      <TopBar />
      <main class="flex-1 overflow-y-auto p-10">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
</script>
