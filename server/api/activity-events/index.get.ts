import type { ActivityDomain, ActivitySeverity } from '../../lib/activity/types'
import { listActivityEvents } from '../../lib/activity/store'
import { isValidDateFilter, isValidTimeZone } from '../../lib/date-range'
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

function queryString(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const normalized = raw?.trim()
  return normalized || undefined
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
  const from = queryString(query.from as string | string[] | undefined)
  const to = queryString(query.to as string | string[] | undefined)
  const timeZone = queryString(query.timeZone as string | string[] | undefined)

  return success(listActivityEvents({
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
    offset: Number.isFinite(offset) ? Math.max(offset, 0) : 0,
    domains,
    severities,
    query: searchQuery || undefined,
    from: from && isValidDateFilter(from) ? from : undefined,
    to: to && isValidDateFilter(to) ? to : undefined,
    timeZone: timeZone && timeZone.length <= 100 && isValidTimeZone(timeZone) ? timeZone : undefined,
  }))
})
