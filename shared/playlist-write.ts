export interface PlaylistWriteProgress {
  phase: 'creating' | 'adding' | 'moving' | 'removing' | 'verifying' | 'uncertain'
  submitted: number
  confirmed: number
  total: number
  batch: number
  batches: number
}

export interface PlaylistWriteNotice {
  kind: 'create' | 'insert' | 'move' | 'remove'
  playlistKey: string
  startedAt: string
}
