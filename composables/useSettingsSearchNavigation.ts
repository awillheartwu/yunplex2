import { onBeforeUnmount, type Ref } from 'vue'
import { getSettingsTarget, settingTargetId } from '~/lib/settings-catalog'
import { useSettingsFocusRequest } from '~/composables/useSettingsFocusRequest'
import { useFeedback } from '~/composables/useFeedback'

export function useSettingsSearchNavigation(loading: Ref<boolean>, activeTab: Ref<string>) {
  const route = useRoute()
  const focusRequest = useSettingsFocusRequest()
  const feedback = useFeedback()
  let generation = 0
  let highlighted: HTMLElement | null = null

  function clearHighlight() {
    highlighted?.classList.remove('setting-search-target')
    highlighted = null
  }

  watch([() => route.query.setting, loading, focusRequest], async ([value]) => {
    const current = ++generation
    clearHighlight()
    const target = getSettingsTarget(value)
    if (import.meta.server || route.path !== '/config' || loading.value || !target) return
    activeTab.value = target.tab
    await nextTick()
    if (current !== generation) return
    let element = document.getElementById(target.elementId)
    const fallback = getSettingsTarget(target.fallback)
    if (!element?.getClientRects().length && fallback) {
      element = document.getElementById(settingTargetId(fallback.key))
      if (element?.getClientRects().length && target.hiddenHint) feedback.info(`${target.label}当前隐藏`, `${target.hiddenHint}「${fallback.label}」。`)
    }
    if (!element?.getClientRects().length) return
    highlighted = element
    element.tabIndex = -1
    // Focus the wrapper so locating a credential does not reveal or edit its input.
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: target.key.startsWith('section:') ? 'start' : 'center', behavior: 'auto' })
    void element.offsetWidth
    element.classList.add('setting-search-target')
  }, { immediate: true, flush: 'post' })

  onBeforeUnmount(() => { generation++; clearHighlight() })
}
