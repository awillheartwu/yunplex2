export type PlaylistStartMode = 'automatic' | 'review'

export interface CreatedPlaylistSources {
  sourceIds: string[]
  mode: PlaylistStartMode
}

export interface InitializationProcessing {
  active: boolean
  status: 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled'
  stage: string
  runId: string | null
  total: number
  synced: number
  failed: number
  remaining: number
  error: string | null
}

export interface DeferredInitializationGroup {
  key: string
  label: string
  count: number
  explanation: string
}
