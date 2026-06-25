export const ACTIVITY_ROUTE = '/activity'
export const ACTIVITY_LOGS_ROUTE = '/activity?tab=logs'

export function resolveLegacyActivityRedirect(path: string, query: Record<string, unknown> = {}): string | null {
  if (path === '/logs') return ACTIVITY_LOGS_ROUTE
  if (path === '/system' && query.tab === 'logs') return ACTIVITY_LOGS_ROUTE
  return null
}
