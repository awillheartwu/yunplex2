import { resolveLegacyActivityRedirect } from '~~/lib/activity-navigation'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const redirect = resolveLegacyActivityRedirect(url.pathname, {
    tab: url.searchParams.get('tab') || undefined,
  })
  if (!redirect) return
  return sendRedirect(event, redirect, 302)
})
