export type ActivityDomain = 'sync' | 'download' | 'plex' | 'user'
export type ActivitySeverity = 'info' | 'success' | 'warning' | 'error'
export type ActivityActor = 'system' | 'user'

export interface ActivityEventContext {
  sourceId?: string
  sourceName?: string
  jobId?: string
  songId?: number
  songName?: string
  ratingKey?: string
  configKey?: string
  changedKeys?: string[]
  taskId?: string
  [key: string]: unknown
}

export interface ActivityEvent {
  id: string
  domain: ActivityDomain
  type: string
  severity: ActivitySeverity
  occurredAt: string
  actor: ActivityActor
  title: string
  summary: string
  context: ActivityEventContext
  link: string | null
  groupKey: string | null
}

export interface CreateActivityEventInput {
  domain: ActivityDomain
  type: string
  severity: ActivitySeverity
  occurredAt?: string
  actor?: ActivityActor
  title: string
  summary: string
  context?: ActivityEventContext
  link?: string | null
  groupKey?: string | null
}

export interface ActivityEventListFilter {
  limit?: number
  offset?: number
  domains?: ActivityDomain[]
  severities?: ActivitySeverity[]
  query?: string
}
