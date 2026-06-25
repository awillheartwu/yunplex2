import { resolveLegacyActivityRedirect } from '~~/lib/activity-navigation'

export default defineNuxtRouteMiddleware((to) => {
  const redirect = resolveLegacyActivityRedirect(to.path, to.query)
  if (!redirect) return
  return navigateTo(redirect, { replace: true, redirectCode: 302 })
})
