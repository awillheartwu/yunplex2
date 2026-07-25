import type { SyncState } from '../log/types'

export const STAGE_LABELS: Record<string, string> = {
  idle: '空闲',
  fetching_playlist: '获取源曲目',
  comparing: '对比歌曲',
  downloading: '下载歌曲',
  processing_tags: '写入元数据',
  refreshing_plex: '刷新 Plex 库',
  updating_plex_playlist: '更新 Plex 歌单',
  reorder: '重排歌单',
  cancelled: '已取消',
  error: '同步错误',
}

export interface SyncRunOptions {
  dryRun?: boolean
  sourceIds?: string[]
  forceFull?: boolean
  rebuildMatch?: boolean
  redownloadAll?: boolean
  takeOverExternal?: boolean
  trigger?: 'user' | 'schedule' | 'system' | 'retry'
}

export function createInitialState(): SyncState {
  return {
    isRunning: false, currentStage: 'idle', startedAt: null,
    currentSourceName: null,
    lastSyncAt: null, lastSyncResult: null, syncCount: 0,
    successCount: 0, failureCount: 0, currentSong: null,
    progress: null, failures: [], dryRun: false,
  }
}

export class CancellationError extends Error {
  constructor() {
    super('Cancelled')
  }
}
