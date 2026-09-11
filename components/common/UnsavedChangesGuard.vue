<template>
  <ConfirmDialog
    :visible="visible"
    :title="saving ? '正在保存设置' : '有未保存的修改'"
    :message="saving ? '请等待保存完成。保存失败时会保留你的修改。' : '离开会丢弃尚未保存的修改。是否继续？'"
    confirm-label="放弃修改并离开"
    cancel-label="继续编辑"
    :confirm-disabled="saving"
    @confirm="finish(true)"
    @cancel="finish(false)"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { registerUnsavedChangesGuard } from '~/lib/unsaved-changes'
const props = defineProps<{ dirty: boolean; saving: boolean }>()
const visible = ref(false)
let pending: ((leave: boolean) => void) | null = null
const auth = useAuth()
const unregister = registerUnsavedChangesGuard(confirmNavigation)

function finish(leave: boolean) {
  visible.value = false
  const resolve = pending
  pending = null
  resolve?.(leave)
}

function confirmNavigation() {
  if (!props.dirty && !props.saving) return true
  finish(false)
  visible.value = true
  return new Promise<boolean>(resolve => { pending = resolve })
}

onBeforeRouteLeave(to => to.path === '/login' && auth.state.value?.authenticated === false ? true : confirmNavigation())
onBeforeRouteUpdate((to, from) => to.path === from.path || confirmNavigation())
watch(() => [props.dirty, props.saving], () => {
  if (visible.value && !props.dirty && !props.saving) finish(true)
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (!props.dirty && !props.saving) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  unregister()
  finish(false)
})
</script>
