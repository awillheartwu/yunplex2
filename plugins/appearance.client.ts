import { useAppearance } from '~/composables/useAppearance'

export default defineNuxtPlugin(nuxtApp => {
  const appearance = useAppearance()
  const auth = useAuth()
  let request: AbortController | undefined
  const stop = watch(() => !!auth.state.value && !auth.state.value.setupRequired && (!auth.state.value.authEnabled || auth.state.value.authenticated), ready => {
    request?.abort()
    if (!ready) return
    request = new AbortController()
    void appearance.refresh(request.signal)
  }, { immediate: true })
  nuxtApp.vueApp.onUnmount(() => { stop(); request?.abort() })
})
