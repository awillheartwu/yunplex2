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
  removed: { label: '已移除', tone: 'neutral', icon: 'minusCircle' },
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
  | 'pending'
  | 'downloading'
  | 'success'
  | 'failure'
  | 'failed_download'
  | 'failed_tags'
  | 'failed_plex_match'
  | 'failed_plex_insert'
  | 'existing'
  | 'removed'
  | 'warning'
  | 'ignored'
  | 'deferred'
  | 'manual'
  | 'restricted'

export type SongStatusExactBucket = Exclude<SongStatusBucket, 'all' | 'failure'>

export interface SongStatusBucketPresentation {
  key: SongStatusBucket
  label: string
  tone: TaskSemanticTone
  icon: string
}

export const SONG_STATUS_BUCKETS: SongStatusBucketPresentation[] = [
  { key: 'all', label: '全部', tone: 'neutral', icon: 'list' },
  { key: 'pending', label: '等待中', tone: 'neutral', icon: 'clock' },
  { key: 'downloading', label: '下载中', tone: 'running', icon: 'loader' },
  { key: 'success', label: '成功', tone: 'success', icon: 'checkCircle' },
  { key: 'existing', label: '已存在', tone: 'existing', icon: 'existing' },
  { key: 'removed', label: '已移除', tone: 'neutral', icon: 'minusCircle' },
  { key: 'warning', label: '保留未删', tone: 'warning', icon: 'warn' },
  { key: 'failed_download', label: '下载失败', tone: 'failure', icon: 'failure' },
  { key: 'failed_tags', label: '标签失败', tone: 'failure', icon: 'failure' },
  { key: 'failed_plex_match', label: 'Plex 匹配失败', tone: 'warning', icon: 'warn' },
  { key: 'failed_plex_insert', label: 'Plex 写入失败', tone: 'warning', icon: 'warn' },
  { key: 'deferred', label: '等待恢复', tone: 'warning', icon: 'clock' },
  { key: 'manual', label: '选择媒体', tone: 'warning', icon: 'search' },
  { key: 'restricted', label: '版权受限', tone: 'ignored', icon: 'ignored' },
  { key: 'ignored', label: '已忽略', tone: 'ignored', icon: 'ignored' },
]

export type SongStatusGroup = 'in_progress' | 'completed' | 'attention' | 'skipped'
export type SongStatusFilter = SongStatusBucket | SongStatusGroup

export const SONG_STATUS_GROUPS: Array<{
  key: SongStatusGroup
  label: string
  tone: TaskSemanticTone
  icon: string
  buckets: SongStatusExactBucket[]
}> = [
  { key: 'in_progress', label: '进行中', tone: 'running', icon: 'loader', buckets: ['pending', 'downloading'] },
  { key: 'completed', label: '已完成', tone: 'success', icon: 'checkCircle', buckets: ['success', 'existing', 'removed'] },
  { key: 'attention', label: '需关注', tone: 'warning', icon: 'warn', buckets: ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert', 'deferred', 'manual', 'warning'] },
  { key: 'skipped', label: '已跳过', tone: 'ignored', icon: 'ignored', buckets: ['restricted', 'ignored'] },
]

const SONG_STATUS_BUCKET_BY_STATUS: Record<SongStatus, SongStatusExactBucket> = {
  pending: 'pending',
  downloading: 'downloading',
  success: 'success',
  skipped_existing: 'existing',
  removed: 'removed',
  extra_skipped: 'warning',
  failed_download: 'failed_download',
  failed_tags: 'failed_tags',
  failed_plex_match: 'failed_plex_match',
  failed_plex_insert: 'failed_plex_insert',
  copyright_restricted: 'restricted',
  awaiting_retry: 'deferred',
  ignored_failure: 'ignored',
  awaiting_manual_match: 'manual',
}

export function songStatusBucketForStatus(status: SongStatus): SongStatusExactBucket {
  return SONG_STATUS_BUCKET_BY_STATUS[status]
}

export function songMatchesStatusBucket(status: SongStatus, bucket: SongStatusFilter): boolean {
  const group = SONG_STATUS_GROUPS.find(group => group.key === bucket)
  if (group) return group.buckets.some(child => songMatchesStatusBucket(status, child))
  if (bucket === 'all') return true
  if (bucket === 'failure') return isFailedSongStatus(status)
  return SONG_STATUS_BUCKET_BY_STATUS[status] === bucket
}

export function songStatusBucketCount(songs: readonly { status: SongStatus }[], bucket: SongStatusFilter): number {
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
    { key: 'warning', label: '保留未删', count: issues.preserved, tone: 'warning', icon: 'warn' },
  ] : [{ key: 'warnings', label: '历史提示', count: run.warnings, tone: 'warning', icon: 'warn' }]
  const historical = issues ? Math.max(0, run.warnings - Object.values(issues).reduce((sum, count) => sum + count, 0)) : 0
  if (historical) issueItems.push({ key: 'historical', label: '历史提示', count: historical, tone: 'warning', icon: 'warn' })
  return [
    { key: 'success', label: '成功', count: run.successSongs, tone: 'success', icon: 'checkCircle' },
    { key: 'existing', label: '已存在', count: run.skippedSongs, tone: 'existing', icon: 'existing' },
    ...issueItems,
    { key: 'removed', label: '已移除', count: run.removedSongs, tone: 'neutral', icon: 'minusCircle' },
    { key: 'failure', label: '失败', count: run.failedSongs, tone: 'failure', icon: 'failure' },
  ]
}
