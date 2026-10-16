<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { registerUnsavedChangesGuard } from '~/lib/unsaved-changes'
const props = defineProps<{ pending: boolean; analyzing: boolean }>()
const visible = ref(false)
let pendingAnswer: ((leave: boolean) => void) | null = null
const auth = useAuth()
function finish(leave: boolean) {
  visible.value = false
  const resolve = pendingAnswer
  pendingAnswer = null
  resolve?.(leave)
}
function confirmNavigation(): boolean | Promise<boolean> {
  if (!props.pending) return true
  finish(false)
  visible.value = true
  return new Promise(resolve => { pendingAnswer = resolve })
}
const unregister = registerUnsavedChangesGuard(confirmNavigation)
onBeforeRouteLeave(to => to.path === '/login' && auth.state.value?.authenticated === false ? true : confirmNavigation())
onBeforeRouteUpdate((to, from) => to.path === from.path && to.query.tab === from.query.tab ? true : confirmNavigation())
function beforeUnload(event: BeforeUnloadEvent) {
  if (!props.pending) return
  event.preventDefault()
  event.returnValue = ''
}
watch(() => props.pending, value => { if (!value) finish(true) })
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload); unregister(); finish(false) })
defineExpose({ confirmNavigation })
</script>

<template>
  <ConfirmDialog :visible="visible" title="歌单还没有开始下载和同步" :message="analyzing ? '分析会在后台继续，但完成后仍需你确认方案。现在离开，歌单不会自动完成同步；再次打开收藏可继续。' : '当前方案已保存，还没有提交处理。现在离开，部分歌曲仍不会加入 Plex；再次打开收藏可继续。'" confirm-label="稍后处理，离开" cancel-label="留下继续处理" @confirm="finish(true)" @cancel="finish(false)" />
</template>
