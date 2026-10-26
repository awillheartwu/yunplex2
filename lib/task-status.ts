import type { SongStatus, TaskRun } from '~~/server/lib/job/types'
import { isAttentionSongStatusProjection } from './media-status-projection'

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
  failed_download: { label: '下载失败', tone: 'failure', icon: 'failure' },
  failed_tags: { label: '标签失败', tone: 'failure', icon: 'failure' },
  failed_plex_match: { label: 'Plex 匹配失败', tone: 'warning', icon: 'warn' },
  failed_plex_insert: { label: 'Plex 插入失败', tone: 'warning', icon: 'warn' },
  copyright_restricted: { label: '版权受限', tone: 'ignored', icon: 'ignored' },
  awaiting_retry: { label: '等待恢复', tone: 'warning', icon: 'clock' },
  ignored_failure: { label: '已忽略', tone: 'ignored', icon: 'ignored' },
  awaiting_manual_match: { label: '等待手动选择', tone: 'ignored', icon: 'search' },
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
  return isAttentionSongStatusProjection(status)
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
  | 'deferred'
  | 'manual'
  | 'restricted'

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
  { key: 'deferred', label: '等待恢复', tone: 'warning', icon: 'clock' },
  { key: 'manual', label: '选择媒体', tone: 'warning', icon: 'search' },
  { key: 'restricted', label: '版权受限', tone: 'ignored', icon: 'ignored' },
  { key: 'ignored', label: '已忽略', tone: 'ignored', icon: 'ignored' },
]

export function songMatchesStatusBucket(status: SongStatus, bucket: SongStatusBucket): boolean {
  if (bucket === 'all') return true
  if (bucket === 'success') return status === 'success'
  if (bucket === 'failure') return isFailedSongStatus(status)
  if (bucket === 'existing') return status === 'skipped_existing'
  if (bucket === 'removed') return status === 'removed'
  if (bucket === 'warning') return status === 'extra_skipped'
  if (bucket === 'ignored') return status === 'ignored_failure'
  if (bucket === 'deferred') return status === 'awaiting_retry'
  if (bucket === 'manual') return status === 'awaiting_manual_match'
  if (bucket === 'restricted') return status === 'copyright_restricted'
  return false
}

export function songStatusBucketCount(songs: Array<{ status: SongStatus }>, bucket: SongStatusBucket): number {
  return songs.filter(song => songMatchesStatusBucket(song.status, bucket)).length
}

export interface RunResultItem {
  key: string
  label: string
  count: number
  tone: TaskSemanticTone
  icon: string
}

export function runResultItems(run: Pick<TaskRun, 'successSongs' | 'skippedSongs' | 'warnings' | 'removedSongs' | 'failedSongs' | 'issueCounts'>): RunResultItem[] {
  const issues = run.issueCounts
  const issueItems: RunResultItem[] = issues ? [
    { key: 'deferred', label: '等待恢复', count: issues.deferred, tone: 'warning', icon: 'clock' },
    { key: 'manual', label: '选择媒体', count: issues.manual, tone: 'warning', icon: 'search' },
    { key: 'restricted', label: '版权受限', count: issues.restricted, tone: 'ignored', icon: 'ignored' },
    { key: 'ignored', label: '已忽略', count: issues.ignored, tone: 'ignored', icon: 'ignored' },
    { key: 'preserved', label: '保留未删', count: issues.preserved, tone: 'warning', icon: 'warn' },
  ] : [{ key: 'warnings', label: '历史提示', count: run.warnings, tone: 'warning', icon: 'warn' }]
  const historical = issues ? Math.max(0, run.warnings - Object.values(issues).reduce((sum, count) => sum + count, 0)) : 0
  if (historical) issueItems.push({ key: 'historical', label: '历史提示', count: historical, tone: 'warning', icon: 'warn' })
  return [
    { key: 'success', label: '成功', count: run.successSongs, tone: 'success', icon: 'checkCircle' },
    { key: 'existing', label: '已存在', count: run.skippedSongs, tone: 'existing', icon: 'existing' },
    ...issueItems,
    { key: 'warning', label: '已移除', count: run.removedSongs, tone: 'warning', icon: 'minusCircle' },
    { key: 'failure', label: '失败', count: run.failedSongs, tone: 'failure', icon: 'failure' },
  ]
}
