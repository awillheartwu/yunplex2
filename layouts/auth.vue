<template>
  <div class="auth-shell">
    <header class="auth-shell__header">
      <div class="auth-shell__brand">
        <span class="auth-shell__logo">
          <AppIcon name="shield" :size="18" />
        </span>
        <span>YunPlex2</span>
      </div>
      <button
        class="icon-button"
        type="button"
        :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
        :title="theme === 'dark' ? '浅色主题' : '深色主题'"
        @click="toggleTheme"
      >
        <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="17" />
      </button>
    </header>
    <main class="auth-shell__main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const { theme, toggle: toggleTheme } = useTheme()
</script>

<style scoped>
.auth-shell {
  min-height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr;
  color: var(--text-primary);
}

.auth-shell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 4.5rem;
  padding: 1rem clamp(1rem, 4vw, 2.5rem);
}

.auth-shell__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  font-size: 0.95rem;
  font-weight: 750;
}

.auth-shell__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-md);
  color: var(--accent);
  background: var(--accent-muted);
  border: 1px solid var(--border-primary);
}

.auth-shell__main {
  display: grid;
  align-items: center;
  justify-items: center;
  min-width: 0;
  padding: 1rem clamp(1rem, 4vw, 2.5rem) 3rem;
}
</style>
