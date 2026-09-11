import { useAppearance } from './useAppearance'
export type { Theme } from '~/lib/appearance'

export function useTheme() {
  const appearance = useAppearance()
  const theme = computed(() => appearance.state.value.theme)
  function toggle() { appearance.setTheme(theme.value === 'dark' ? 'light' : 'dark') }
  return { theme, toggle }
}
