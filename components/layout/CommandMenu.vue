<template>
  <button class="command-trigger" aria-label="搜索页面与音乐收藏" aria-haspopup="dialog" :aria-expanded="open" @click="show"><AppIcon name="search" :size="16" /><span>搜索收藏、页面…</span><kbd>⌘ K</kbd></button>
  <Teleport to="body"><div v-if="open" class="command-backdrop" @click.self="close"><section ref="panel" class="command-menu" role="dialog" aria-modal="true" aria-label="搜索与快捷跳转" tabindex="-1" @keydown="onKeydown"><div class="command-menu__input"><AppIcon name="search" :size="20" /><input ref="input" v-model="query" aria-label="搜索页面与收藏" placeholder="搜索歌单、专辑或跳转页面…" autocomplete="off" @input="index = 0"><button class="btn btn-ghost btn-xs" aria-label="关闭搜索" @click="close">Esc</button></div><div class="command-menu__results"><p v-if="loading" role="status">正在读取收藏…</p><p v-if="error" role="status">{{ error }}</p><p v-if="!loading && !results.length">没有找到结果，试试其他名称。</p><template v-for="(result, i) in results" :key="result.path"><p v-if="i === 0 || result.group !== results[i - 1]?.group" class="command-menu__group">{{ result.group }}</p><NuxtLink :to="result.path" class="command-result" :class="{ 'is-active': i === index }" @mousemove="index = i" @click="close"><AppIcon :name="result.icon" :size="18" /><span>{{ result.label }}<small>{{ result.description }}</small></span><AppIcon name="arrowRight" :size="14" /></NuxtLink></template></div><footer>↑ ↓ 选择<span>Enter 打开</span><span>Esc 关闭</span></footer></section></div></Teleport>
</template>
<script setup lang="ts">
import { useDialogFocus } from '~/composables/useDialogFocus'
import type { PlaylistSource } from '~~/server/lib/playlist/types'
import { managementNavigation, workspaceNavigation } from '~/lib/navigation'
const open = ref(false), query = ref(''), loading = ref(false), error = ref(''), index = ref(0)
const input = ref<HTMLInputElement | null>(null), panel = ref<HTMLElement | null>(null)
const sources = ref<PlaylistSource[]>([])
let generation = 0
const pages = [...workspaceNavigation, ...managementNavigation].map(item => ({ ...item, group: '快速跳转' }))
const results = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  const matches = pages.filter(item => `${item.label} ${item.description}`.toLocaleLowerCase().includes(needle))
  const collection = sources.value.filter(item => `${item.name} ${item.neteasePlaylistName} ${item.neteasePlaylistId}`.toLocaleLowerCase().includes(needle)).slice(0, 12).map(item => ({ label: item.name || item.neteasePlaylistName, description: `${item.trackCount} 首 · ${item.type === 'album' ? '专辑' : '歌单'}`, path: `/sync-sources/${item.id}`, icon: item.type === 'album' ? 'album' : 'music', group: '音乐收藏' }))
  return [...matches, ...collection]
})
async function show() {
  if (open.value) return
  open.value = true; query.value = ''; index.value = 0; error.value = ''; loading.value = true
  const current = ++generation
  await nextTick(); input.value?.focus()
  try { const data = await useApi().get<PlaylistSource[]>('/playlist-sources'); if (current === generation) sources.value = data }
  catch { if (current === generation) error.value = '收藏暂时无法读取，仍可跳转页面。' }
  finally { if (current === generation) loading.value = false }
}
function close() { if (!open.value) return; open.value = false; generation++ }
useDialogFocus(open, panel, close)
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); index.value = (index.value + (event.key === 'ArrowDown' ? 1 : -1) + results.value.length) % Math.max(1, results.value.length); panel.value?.querySelectorAll('.command-result')[index.value]?.scrollIntoView({ block: 'nearest' }) }
  if (event.key === 'Enter' && event.target === input.value && results.value[index.value]) { event.preventDefault(); void navigateTo(results.value[index.value]!.path); close() }
}
function shortcut(event: KeyboardEvent) { if (!open.value && document.querySelector('[aria-modal="true"]')) return; if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (open.value) close(); else void show() } }
onMounted(() => window.addEventListener('keydown', shortcut))
onUnmounted(() => { window.removeEventListener('keydown', shortcut); close() })
</script>
<style scoped>
.command-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2_5);
  width: min(22rem, 35vw);
  height: 2.4rem;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.command-trigger kbd {
  margin-left: auto;
  font-size: var(--text-xs);
}
.command-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 15vh var(--space-4) var(--space-4);
  background: var(--bg-overlay);
  backdrop-filter: blur(5px);
}
.command-menu {
  width: min(38rem, 100%);
  background: var(--bg-elevated);
  border: 1px solid var(--border-secondary);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.command-menu__input {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-primary);
  color: var(--text-secondary);
}
.command-menu__input input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text-primary);
  font-size: var(--text-base);
}
.command-menu__results {
  max-height: 55vh;
  overflow: auto;
  padding: var(--space-2);
}
.command-menu__results > p {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: var(--space-2_5);
}
.command-result {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  color: var(--text-secondary);
}
.command-result.is-active {
  background: var(--accent-muted);
  color: var(--accent);
}
.command-result > span {
  flex: 1;
  min-width: 0;
}
.command-result small {
  display: block;
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
.command-menu footer {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-primary);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
@media (max-width: 767px) {
  .command-trigger {
    width: 2.5rem;
    justify-content: center;
    padding: 0;
  }
  .command-trigger span,
  .command-trigger kbd {
    display: none;
  }
  .command-backdrop {
    padding-top: var(--space-12);
  }
  .command-menu__input {
    padding: var(--space-3);
  }
  .command-menu__input .btn {
    min-height: 44px;
  }
  .command-menu__results {
    max-height: 65dvh;
  }
}
</style>
