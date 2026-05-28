export default defineNuxtPlugin(async () => {
  try {
    const res = await fetch('/api/config')
    const json = await res.json() as { data?: { other?: { fontScale?: number } } }
    const scale = json.data?.other?.fontScale ?? 1
    document.documentElement.style.setProperty('--font-scale', String(scale))
  } catch {
    document.documentElement.style.setProperty('--font-scale', '1')
  }
})
