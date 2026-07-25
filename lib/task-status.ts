import type { SongStatus, TaskRun } from '~~/server/lib/job/types'

export type TaskSemanticTone =
  | 'success'
  | 'existing'
  | 'ignored'
  | 'warning'
  | 'failure'
  | 'running'
  | 'neutral'

export interface SongStatusPresentation {
  label: string
  tone: TaskSemanticTone
  icon: string
}

const SONG_STATUS_PRESENTATION: Record<SongStatus, SongStatusPresentation> = {
  pending: { label: '等待中', tone: 'neutral', icon: 'clock' },
  downloading: { label: '下载中', tone: 'running', icon: 'loader' },
  success: { label: '成功', tone: 'success', icon: 'checkCircle' },
  skipped_existing: { label: '已存在', tone: 'existing', icon: 'existing' },
  removed: { label: '已移除', tone: 'warning', icon: 'minusCircle' },
  extra_skipped: { label: '保留未删', tone: 'warning', icon: 'warn' },
  match_pending_review: { label: '待审核', tone: 'warning', icon: 'warn' },
  failed_download: { label: '下载失败', tone: 'failure', icon: 'failure' },
  failed_tags: { label: '标签失败', tone: 'failure', icon: 'failure' },
  failed_plex_match: { label: 'Plex 匹配失败', tone: 'warning', icon: 'warn' },
  failed_plex_insert: { label: 'Plex 插入失败', tone: 'warning', icon: 'warn' },
  copyright_restricted: { label: '版权受限', tone: 'ignored', icon: 'ignored' },
  ignored_failure: { label: '已暂停重试', tone: 'ignored', icon: 'ignored' },
}

export function songStatusPresentation(status: SongStatus): SongStatusPresentation {
  return SONG_STATUS_PRESENTATION[status]
}

export function semanticToneClass(tone: TaskSemanticTone): string {
  return `semantic-${tone}`
}

export function isFailedSongStatus(status: SongStatus): boolean {
  return ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(status)
}

export function isAttentionSongStatus(status: SongStatus): boolean {
  return status === 'copyright_restricted' || status === 'ignored_failure'
}

/** @deprecated Kept for compatibility with callers using the legacy bucket name. */
export const isIgnoredSongStatus = isAttentionSongStatus

export type SongStatusBucket =
  | 'all'
  | 'success'
  | 'failure'
  | 'existing'
  | 'removed'
  | 'warning'
  | 'ignored'

export interface SongStatusBucketPresentation {
  key: SongStatusBucket
  label: string
  tone: TaskSemanticTone
  icon: string
}

export const SONG_STATUS_BUCKETS: SongStatusBucketPresentation[] = [
  { key: 'all', label: '全部', tone: 'neutral', icon: 'list' },
  { key: 'success', label: '成功', tone: 'success', icon: 'checkCircle' },
  { key: 'failure', label: '失败', tone: 'failure', icon: 'failure' },
  { key: 'existing', label: '已存在', tone: 'existing', icon: 'existing' },
  { key: 'removed', label: '已移除', tone: 'warning', icon: 'minusCircle' },
  { key: 'warning', label: '保留未删', tone: 'warning', icon: 'warn' },
  { key: 'ignored', label: '需关注', tone: 'ignored', icon: 'ignored' },
]

export function songMatchesStatusBucket(status: SongStatus, bucket: SongStatusBucket): boolean {
  if (bucket === 'all') return true
  if (bucket === 'success') return status === 'success'
  if (bucket === 'failure') return isFailedSongStatus(status)
  if (bucket === 'existing') return status === 'skipped_existing'
  if (bucket === 'removed') return status === 'removed'
  if (bucket === 'warning') return status === 'extra_skipped' || status === 'match_pending_review'
  if (bucket === 'ignored') return isAttentionSongStatus(status)
  return false
}

export function songStatusBucketCount(songs: Array<{ status: SongStatus }>, bucket: SongStatusBucket): number {
  return songs.filter(song => songMatchesStatusBucket(song.status, bucket)).length
}

export interface RunResultItem {
  key: 'success' | 'existing' | 'ignored' | 'warning' | 'failure'
  label: string
  count: number
  tone: TaskSemanticTone
  icon: string
}

export function runResultItems(run: Pick<TaskRun, 'successSongs' | 'skippedSongs' | 'warnings' | 'removedSongs' | 'failedSongs'>): RunResultItem[] {
  return [
    { key: 'success', label: '成功', count: run.successSongs, tone: 'success', icon: 'checkCircle' },
    { key: 'existing', label: '已存在', count: run.skippedSongs, tone: 'existing', icon: 'existing' },
    { key: 'ignored', label: '需关注', count: run.warnings, tone: 'ignored', icon: 'ignored' },
    { key: 'warning', label: '已移除', count: run.removedSongs, tone: 'warning', icon: 'minusCircle' },
    { key: 'failure', label: '失败', count: run.failedSongs, tone: 'failure', icon: 'failure' },
  ]
}
