// ── Status enums ──

export type JobStatus = 'running' | 'success' | 'partial' | 'failed' | 'cancelled'

export type StepStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'skipped' | 'cancelled'

export type SongStatus =
  | 'pending'
  | 'downloading'
  | 'success'
  | 'skipped_existing'
  | 'removed'
  | 'failed_download'
  | 'failed_tags'
  | 'failed_plex_match'
  | 'failed_plex_insert'

// ── Core entities ──

export interface SongTask {
  id: string
  sourceId?: string
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
  }
  ops?: {
    download: 'ok' | 'failed'
    lyric: 'ok' | 'failed' | 'skipped'
    tags: 'ok' | 'failed' | 'skipped'
    cover: 'ok' | 'failed' | 'skipped'
  }
}

export interface StepError {
  title: string
  message: string
  stage: string
  songName?: string
  artist?: string
  context?: Record<string, unknown>
  stack?: string
  raw?: string
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
  error?: StepError
  children: JobStep[]
}

export interface SyncJob {
  id: string
  startedAt: string
  finishedAt: string | null
  status: JobStatus
  durationMs: number
  summary: string
  source: string
  target: string
  totalSongs: number
  successSongs: number
  failedSongs: number
  skippedSongs: number
  removedSongs: number
  warnings: number
  dryRun: boolean
  steps: JobStep[]
  songs: SongTask[]
  config: {
    playlistId?: number
    quality?: string
    server?: string
    section?: string
  }
}

// ── Query / filter types ──

export interface JobFilter {
  status?: JobStatus
  search?: string
  limit?: number
  offset?: number
  from?: string
  to?: string
}

export interface JobSummary {
  id: string
  startedAt: string
  finishedAt: string | null
  status: JobStatus
  durationMs: number
  summary: string
  totalSongs: number
  successSongs: number
  failedSongs: number
  skippedSongs: number
  removedSongs: number
  dryRun: boolean
}
