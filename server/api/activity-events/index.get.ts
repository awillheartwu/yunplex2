import type { ActivityDomain, ActivitySeverity } from '../../lib/activity/types'
import { listActivityEvents } from '../../lib/activity/store'
import { success } from '../../lib/response'

const ALLOWED_DOMAINS: ActivityDomain[] = ['sync', 'download', 'plex', 'user']
const ALLOWED_SEVERITIES: ActivitySeverity[] = ['info', 'success', 'warning', 'error']

function queryValues(value: string | string[] | undefined): string[] {
  if (!value) return []
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const limit = Number.parseInt(String(query.limit ?? '20'), 10)
  const offset = Number.parseInt(String(query.offset ?? '0'), 10)
  const domains = queryValues(query.domain as string | string[] | undefined)
    .filter((domain): domain is ActivityDomain => ALLOWED_DOMAINS.includes(domain as ActivityDomain))
  const severities = queryValues(query.severity as string | string[] | undefined)
    .filter((severity): severity is ActivitySeverity => ALLOWED_SEVERITIES.includes(severity as ActivitySeverity))
  const searchQuery = typeof query.q === 'string' ? query.q.trim() : ''

  return success(listActivityEvents({
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
    offset: Number.isFinite(offset) ? Math.max(offset, 0) : 0,
    domains,
    severities,
    query: searchQuery || undefined,
  }))
})
