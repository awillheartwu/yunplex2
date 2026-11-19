export interface PlexLibraryMonitorSnapshot {
  configured: boolean
  connected: boolean
  section: string
  lastCheckedAt: string | null
  libraryChangedAt: string | null
  error: string | null
  scan: { progress: number | null; title: string; subtitle: string } | null
}

export interface PlexSourceNotice {
  kind: 'changed' | 'missing'
  message: string
}
