import type { DomainErrorCode } from '../../../shared/domain-errors'
import type { RunFailureHandlingState } from '../../../shared/failure-handling'

// ── Status enums ──

export type JobStatus = 'running' | 'awaiting_action' | 'success' | 'partial' | 'failed' | 'cancelled'

export type StepStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'skipped' | 'cancelled'

export type SongStatus =
  | 'pending'
  | 'downloading'
  | 'success'
  | 'skipped_existing'
  | 'removed'
  | 'extra_skipped'
  | 'failed_download'
  | 'failed_tags'
  | 'failed_plex_match'
  | 'failed_plex_insert'
  | 'copyright_restricted'
  | 'ignored_failure'
  | 'awaiting_retry'
  | 'awaiting_manual_match'

// ── Core entities ──

export interface SongTask {
  id: string
  sourceId?: string
  neteaseSongId?: number
  /** Occurrence index within the fetched target list; duplicate song IDs remain distinct. */
  neteaseIndex?: number
  songName: string
  artist: string
  album: string
  status: SongStatus
  phase: 'download' | 'tags' | 'plex_match' | 'plex_insert' | 'done'
  filePath?: string
  fileType?: string
  error?: StepError
  metadata?: {
    trackNumber?: number
    year?: string
    quality?: string
    duration?: number
    disc?: string
    genre?: string
    label?: string
    releaseDate?: string
    plexRatingKey?: string
    plexPlaylistRatingKey?: string
    plexPlaylistItemId?: number
    matchTrace?: Record<string, unknown>
  }
  ops?: {
    download: 'ok' | 'failed' | 'skipped'
    lyric: 'ok' | 'failed' | 'skipped'
    tags: 'ok' | 'failed' | 'skipped'
    cover: 'ok' | 'failed' | 'skipped'
  }
}

export interface StepError {
  title: string
  message: string
  stage: string
  code?: DomainErrorCode
  songName?: string
  artist?: string
  context?: Record<string, unknown>
  stack?: string
  raw?: string
}

export interface JobStepContext {
  playlistProgress?: import('../../../shared/playlist-write').PlaylistWriteProgress
  sourceId?: string
  sourceName?: string
  sourceType?: 'playlist' | 'album' | string
  playlistName?: string
  plexPlaylistName?: string
  plexPlaylistRatingKey?: string
  neteasePlaylistId?: number
  sectionKey?: string
  [key: string]: unknown
}

export interface JobStep {
  id: string
  type: string
  title: string
  status: StepStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number
  message: string
  context?: JobStepContext
  error?: StepError
  children: JobStep[]
}

export type SyncRunType = 'sync' | 'repair'
export type TaskRunType = SyncRunType | 'manual_download' | 'source_initialization'
export type TaskRunTrigger = 'user' | 'schedule' | 'system' | 'retry'
export type SourceRequestStatus = 'pending' | 'running'

export interface SyncJob {
  issueCounts?: RunIssueCounts
  id: string
  type: SyncRunType
  startedAt: string
  finishedAt: string | null
  status: JobStatus
  durationMs: number
  summary: string
  source: string
  sourceIds?: string[]
  target: string
  totalSongs: number
  successSongs: number
  failedSongs: number
  skippedSongs: number
  removedSongs: number
  warnings: number
  dryRun: boolean
  /** Full step and song detail was compacted after the diagnostic retention window. */
  detailsExpired?: boolean
  steps: JobStep[]
  songs: SongTask[]
  config: {
    playlistId?: number
    quality?: string
    server?: string
    section?: string
  }
}

export interface TaskRun extends Omit<SyncJob, 'type'> {
  type: TaskRunType
  trigger: TaskRunTrigger
  awaitingSourceSync?: boolean
  sourceRequestStatus?: SourceRequestStatus | null
  /** Current exception handling state, read separately from the historical run result. */
  currentFailures?: RunFailureHandlingState[]
  initializationResult?: { applied: number; downloads: number; deferred: number; conflicts: number }
}

// ── Query / filter types ──

export interface TaskRunSummary {
  issueCounts?: RunIssueCounts
  id: string
  type: TaskRunType
  trigger: TaskRunTrigger
  startedAt: string
  finishedAt: string | null
  status: JobStatus
  durationMs: number
  summary: string
  source: string
  totalSongs: number
  successSongs: number
  failedSongs: number
  skippedSongs: number
  removedSongs: number
  warnings: number
  dryRun: boolean
  awaitingSourceSync: boolean
  sourceRequestStatus: SourceRequestStatus | null
}

export interface RunIssueCounts {
  deferred: number
  ignored: number
  manual: number
  preserved: number
  restricted: number
}

export interface TaskRunFilter {
  type?: TaskRunType
  status?: JobStatus
  search?: string
  sourceId?: string
  limit?: number
  offset?: number
  from?: string
  to?: string
  timeZone?: string
}
