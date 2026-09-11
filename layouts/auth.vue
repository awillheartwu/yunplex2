<template>
  <div class="auth-shell">
    <header class="auth-shell__header">
      <div class="auth-shell__brand">
        <span class="auth-shell__logo">
          <AppIcon name="music" :size="18" />
        </span>
        <span>reYunPlex</span>
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
      <div class="auth-stage" :class="{ 'auth-stage--login': route.path === '/login' }">
        <aside v-if="route.path === '/login'" class="auth-intro">
          <p class="auth-intro__eyebrow">YOUR MUSIC, CONNECTED</p>
          <h2>喜欢的音乐，<br>在自己的音乐库里。</h2>
          <p>让网易云歌单、本地音乐与 Plex 保持同步。<br>从每一次收藏，到每一次播放。</p>
          <ol class="auth-intro__flow"><li><AppIcon name="source" :size="20" /><span>网易云歌单</span></li><li><AppIcon name="folder" :size="20" /><span>本地音乐</span></li><li><AppIcon name="music" :size="20" /><span>Plex 媒体库</span></li></ol>
        </aside>
        <slot />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const { theme, toggle: toggleTheme } = useTheme()
const route = useRoute()
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
  gap: var(--space-4);
  min-height: 4.5rem;
  padding: 1rem clamp(1rem, 4vw, 2.5rem);
}

.auth-shell__brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2_5);
  font-size: var(--text-md);
  font-weight: var(--font-weight-bold);
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

.auth-stage { width: 100%; display: grid; justify-items: center; }
.auth-stage--login { max-width: 68rem; grid-template-columns: 1fr 1fr; align-items: center; gap: var(--space-20); }
.auth-intro { justify-self: start; }
.auth-intro__eyebrow { color: var(--accent); font-size: var(--text-xs); letter-spacing: .15em; font-weight: var(--font-weight-semibold); }
.auth-intro h2 { margin: var(--space-5) 0; font-size: var(--text-4xl); font-weight: var(--font-weight-semibold); line-height: 1.5; }
.auth-intro > p:last-of-type { font-size: var(--text-base); color: var(--text-secondary); line-height: 1.9; }
.auth-intro__flow { display: flex; gap: var(--space-7); margin: var(--space-10) 0 0; padding: 0; list-style: none; }
.auth-intro__flow li { display: grid; gap: var(--space-3_5); color: var(--accent); }
.auth-intro__flow span { font-size: var(--text-xs); color: var(--text-secondary); }
@media (max-width: 900px) { .auth-stage--login { grid-template-columns: 1fr; gap: var(--space-8); } .auth-intro { display: none; } }
</style>
