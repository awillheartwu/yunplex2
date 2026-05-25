<template>
  <div class="flex h-screen overflow-hidden" style="background:var(--bg-app);color:var(--text-primary)">
    <Sidebar />
    <div class="flex-1 flex flex-col min-w-0">
      <TopBar />
      <main class="flex-1 overflow-auto p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
