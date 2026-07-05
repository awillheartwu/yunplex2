export default defineNuxtPlugin(async () => {
  try {
    const authRes = await fetch('/api/auth/state')
    const authJson = await authRes.json() as { data?: { authenticated?: boolean; setupRequired?: boolean; authEnabled?: boolean } }
    const authState = authJson.data
    if (!authState || (authState.authEnabled && (!authState.authenticated || authState.setupRequired))) {
      document.documentElement.style.setProperty('--font-scale', '1')
      return
    }

    const res = await fetch('/api/config')
    const json = await res.json() as { data?: { other?: { fontScale?: number } } }
    const scale = json.data?.other?.fontScale ?? 1
    document.documentElement.style.setProperty('--font-scale', String(scale))
  } catch {
    document.documentElement.style.setProperty('--font-scale', '1')
  }
})
