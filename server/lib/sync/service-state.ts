import type { SyncState } from '../log/types'

export const SYNC_MODES = ['normal', 'preview', 'full', 'rebuild_matching', 'redownload_managed'] as const
export type SyncMode = typeof SYNC_MODES[number]

export function isSyncMode(value: unknown): value is SyncMode {
  return typeof value === 'string' && SYNC_MODES.includes(value as SyncMode)
}

export const STAGE_LABELS: Record<string, string> = {
  idle: '空闲',
  fetching_playlist: '获取源曲目',
  comparing: '对比歌曲',
  downloading: '下载歌曲',
  processing_tags: '处理下载与标签',
  refreshing_plex: '等待 Plex 扫描与索引',
  updating_plex_playlist: '更新 Plex 歌单',
  reorder: '重排歌单',
  cancelled: '已取消',
  error: '同步错误',
}

export interface SyncRunOptions {
  /** Internal event follow-up: reuse indexed media without downloads or rescans. */
  plexRecoveryOnly?: boolean
  plexRecoverySnapshot?: PlexRecoverySnapshot
  mode?: SyncMode
  sourceIds?: string[]
  takeOverExternal?: boolean
  trigger?: 'user' | 'schedule' | 'system' | 'retry'
}

export interface PlexRecoverySnapshot {
  configFingerprint: string
  playlistRatingKey: string
  neteaseCursor: string
  plexFingerprint: string
  bindingVersions: Array<[number, string | null]>
}

export function createInitialState(): SyncState {
  return {
    isRunning: false, currentStage: 'idle', stageHistory: [], startedAt: null,
    currentSourceName: null,
    lastSyncAt: null, lastSyncResult: null, syncCount: 0,
    successCount: 0, failureCount: 0, currentSong: null,
    progress: null, failures: [], dryRun: false,
  }
}

export class CancellationError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancellationError'
  }
}
