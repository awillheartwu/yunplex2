export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  detail?: string
  stage?: SyncStage
  errorCode?: import('../../../shared/domain-errors').DomainErrorCode
  errorCategory?: import('../../../shared/domain-errors').DomainErrorCategory
  retryable?: boolean
}

export type SyncStage =
  | 'idle'
  | 'download'
  | 'tags'
  | 'plex_match'
  | 'plex_insert'
  | 'done'
  | 'fetching_playlist'
  | 'comparing'
  | 'downloading'
  | 'processing_tags'
  | 'refreshing_plex'
  | 'updating_plex_playlist'
  | 'reorder'
  | 'cancelled'
  | 'error'
  | 'repair'

export interface SyncState {
  isRunning: boolean
  currentStage: SyncStage
  startedAt: string | null
  currentSourceName: string | null
  lastSyncAt: string | null
  lastSyncResult: 'success' | 'partial' | 'failure' | null
  syncCount: number
  successCount: number
  failureCount: number
  currentSong: string | null
  progress: { current: number; total: number } | null
  failures: SyncFailure[]
  dryRun: boolean
}

export interface SyncFailure {
  songName: string
  reason: string
  timestamp: string
}

export interface SyncProgress {
  stage: SyncStage
  stageLabel: string
  current: number
  total: number
  currentSong: string | null
}
