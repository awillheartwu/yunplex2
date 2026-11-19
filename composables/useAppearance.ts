import { initializeAppearance, applyAppearance, type Appearance, type Theme } from '~/lib/appearance'
import { fetchWithTimeout } from '~/lib/fetch-with-timeout'

export function useAppearance() {
  const state = useState<Appearance>('ui-appearance', initializeAppearance)
  const revision = useState<number>('ui-appearance-revision', () => 0)
  function setTheme(theme: Theme) { state.value = applyAppearance({ ...state.value, theme }) }
  function setScale(scale: number) { revision.value++; state.value = applyAppearance({ ...state.value, scale }) }
  async function refresh(signal?: AbortSignal) {
    const version = revision.value
    try {
      const result = await fetchWithTimeout('/api/appearance', { credentials: 'same-origin', signal }, 2500, async response => {
        if (!response.ok) throw new Error('读取外观设置失败')
        return await response.json() as { code: number; data?: { fontScale?: number } }
      })
      const scale = result.data?.fontScale
      if (result.code === 0 && typeof scale === 'number' && scale >= .8 && scale <= 1.5 && !signal?.aborted && version === revision.value) state.value = applyAppearance({ ...state.value, scale })
    } catch { /* Keep cached appearance when the service is slow or unavailable. */ }
  }
  return { state, setTheme, setScale, refresh }
}
