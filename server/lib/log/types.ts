export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  detail?: string
  stage?: SyncStage
}

export type SyncStage =
  | 'idle'
  | 'fetching_playlist'
  | 'comparing'
  | 'downloading'
  | 'processing_tags'
  | 'refreshing_plex'
  | 'updating_plex_playlist'
  | 'cancelled'
  | 'error'

export interface SyncState {
  isRunning: boolean
  currentStage: SyncStage
  startedAt: string | null
  lastSyncAt: string | null
  lastSyncResult: 'success' | 'failure' | null
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
