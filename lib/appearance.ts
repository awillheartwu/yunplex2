export type Theme = 'dark' | 'light'
export interface Appearance { theme: Theme; scale: number }

// Self-contained so Nuxt can also serialize it into the document head, before paint.
export function initializeAppearance(): Appearance {
  let theme: Theme = 'dark', scale = 1
  try {
    const savedTheme = localStorage.getItem('yunplex2-theme')
    if (savedTheme === 'light') theme = 'light'
    const savedScale = Number(localStorage.getItem('yunplex2-font-scale'))
    if (Number.isFinite(savedScale) && savedScale >= .8 && savedScale <= 1.5) scale = savedScale
  } catch { /* Storage may be unavailable; the page still needs a usable default. */ }
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.setProperty('--font-scale', String(scale))
  }
  return { theme, scale }
}

export function applyAppearance(value: Appearance) {
  const theme = value.theme === 'light' ? 'light' : 'dark'
  const scale = Number.isFinite(value.scale) && value.scale >= .8 && value.scale <= 1.5 ? value.scale : 1
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.setProperty('--font-scale', String(scale))
  try {
    localStorage.setItem('yunplex2-theme', theme)
    localStorage.setItem('yunplex2-font-scale', String(scale))
  } catch { /* Appearance changes also work without persistent storage. */ }
  return { theme, scale } as Appearance
}
