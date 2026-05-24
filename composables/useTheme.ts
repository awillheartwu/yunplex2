export type Theme = 'dark' | 'light'

export function useTheme() {
  const theme = ref<Theme>('dark')

  function apply(t: Theme) {
    theme.value = t
    document.documentElement.classList.toggle('dark', t === 'dark')
    localStorage.setItem('yunplex2-theme', t)
  }

  function toggle() {
    apply(theme.value === 'dark' ? 'light' : 'dark')
  }

  // Init from localStorage, default dark
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('yunplex2-theme') : null
  apply((saved as Theme) || 'dark')

  return { theme, toggle }
}
