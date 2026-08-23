import type { JobStatus, TaskRunFilter, TaskRunType } from './job/types'
import type { PlaylistSource } from './playlist/types'
import type { PlaylistSourceFilter } from './playlist/store'
import type { FailureRecordFilter, FailureRecordStatus } from './tasks/failure-records'
import { isValidDateFilter, isValidTimeZone } from './date-range'

type QueryValue = string | string[] | number | boolean | null | undefined
type QueryRecord = Record<string, unknown>

const RUN_TYPES = new Set<TaskRunType>(['sync', 'repair', 'manual_download'])
const JOB_STATUSES = new Set<JobStatus>(['running', 'success', 'partial', 'failed', 'cancelled'])
const SOURCE_TYPES = new Set<NonNullable<PlaylistSourceFilter['type']>>(['playlist', 'album'])
const SOURCE_STATUSES = new Set<PlaylistSource['lastStatus']>(['idle', 'success', 'partial', 'failed'])
const FAILURE_KINDS = new Set([
  'failed_download',
  'failed_tags',
  'failed_plex_match',
  'failed_plex_insert',
  'copyright_restricted',
  'ignored_failure',
])
const FAILURE_RECORD_STATUSES = new Set<FailureRecordStatus>(['open', 'ignored', 'resolved'])

function firstValue(value: unknown): QueryValue {
  if (Array.isArray(value)) return firstValue(value[0])
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value
  }
  return undefined
}

function stringParam(query: QueryRecord, key: string): string | undefined {
  const value = firstValue(query[key])
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  return text || undefined
}

function parseBoundedInt(query: QueryRecord, key: string, fallback: number, min: number, max = 500): number {
  const value = Number.parseInt(stringParam(query, key) ?? '', 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

export function parseOptionalBoolean(value: unknown): boolean | undefined {
  const raw = firstValue(value)
  if (raw === undefined || raw === null || raw === '') return undefined
  if (raw === true || raw === '1' || raw === 'true') return true
  if (raw === false || raw === '0' || raw === 'false') return false
  return undefined
}

function enumParam<T extends string>(query: QueryRecord, key: string, allowed: Set<T>): T | undefined {
  const value = stringParam(query, key)
  return value && allowed.has(value as T) ? value as T : undefined
}

function dateParam(query: QueryRecord, key: string): string | undefined {
  const value = stringParam(query, key)
  return value && isValidDateFilter(value) ? value : undefined
}

function timeZoneParam(query: QueryRecord): string | undefined {
  const value = stringParam(query, 'timeZone')
  return value && value.length <= 100 && isValidTimeZone(value) ? value : undefined
}

export function parsePlaylistSourceFilters(query: QueryRecord): PlaylistSourceFilter {
  return {
    search: stringParam(query, 'search'),
    type: enumParam(query, 'type', SOURCE_TYPES),
    enabled: parseOptionalBoolean(query.enabled),
    subscribed: parseOptionalBoolean(query.subscribed),
    lastStatus: enumParam(query, 'lastStatus', SOURCE_STATUSES),
    hasIgnored: parseOptionalBoolean(query.hasIgnored),
    hasCopyright: parseOptionalBoolean(query.hasCopyright),
  }
}

export function parseRunFilters(query: QueryRecord): TaskRunFilter {
  return {
    type: enumParam(query, 'type', RUN_TYPES),
    status: enumParam(query, 'status', JOB_STATUSES),
    search: stringParam(query, 'search'),
    sourceId: stringParam(query, 'sourceId'),
    limit: parseBoundedInt(query, 'limit', 50, 1),
    offset: parseBoundedInt(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
    from: dateParam(query, 'from'),
    to: dateParam(query, 'to'),
    timeZone: timeZoneParam(query),
  }
}

export function parseFailureRecordFilters(query: QueryRecord): FailureRecordFilter {
  return {
    status: enumParam(query, 'status', FAILURE_RECORD_STATUSES) || 'open',
    type: enumParam(query, 'type', RUN_TYPES),
    failureKind: enumParam(query, 'failureKind', FAILURE_KINDS),
    sourceId: stringParam(query, 'sourceId'),
    search: stringParam(query, 'search'),
    from: dateParam(query, 'from'),
    to: dateParam(query, 'to'),
    timeZone: timeZoneParam(query),
    limit: parseBoundedInt(query, 'limit', 50, 1, 100),
    offset: parseBoundedInt(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
  }
}
