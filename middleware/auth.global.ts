export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const auth = useAuth()
  const state = await auth.ensureState().catch(() => null)
  if (!state || !state.authEnabled) return

  if (state.setupRequired) {
    if (to.path !== '/setup') return navigateTo('/setup')
    return
  }

  if (to.path === '/setup') return navigateTo('/')

  if (!state.authenticated) {
    if (to.path !== '/login') {
      return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
    }
    return
  }

  if (to.path === '/login') {
    return navigateTo(typeof to.query.redirect === 'string' ? to.query.redirect : '/')
  }
})
