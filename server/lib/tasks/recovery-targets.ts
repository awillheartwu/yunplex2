import type { AppConfig } from '../config/types'
import { getDb } from '../db'
import { getSource } from '../playlist/store'
import { failureSubjectKey, plexRemovalTarget } from './failure-identity'
import { resolveInitializationGate } from '../source-initialization/gate'

export const RETRYABLE_FAILURE_SQL = `fr.status != 'resolved' AND (
  (fr.source_id IS NOT NULL AND EXISTS (SELECT 1 FROM playlist_sources source WHERE source.id=fr.source_id)
    AND (fr.song_id IS NULL OR EXISTS (SELECT 1 FROM playlist_source_track_occurrences member
      WHERE member.source_id=fr.source_id AND member.netease_song_id=fr.song_id AND member.membership_status='current')))
  OR (TRIM(COALESCE(fr.download_task_ids,''))<>''
    AND NOT EXISTS (SELECT 1 FROM playlist_source_track_occurrences member
      WHERE member.source_id=fr.source_id AND member.netease_song_id=fr.song_id)
    AND EXISTS (SELECT 1 FROM download_tasks task WHERE task.status='failed'
      AND INSTR(',' || fr.download_task_ids || ',', ',' || task.id || ',')>0))
)`

export const LEFT_SOURCE_SQL = `EXISTS (SELECT 1 FROM playlist_source_track_occurrences member
  WHERE member.source_id=fr.source_id AND member.netease_song_id=fr.song_id)
  AND NOT EXISTS (SELECT 1 FROM playlist_source_track_occurrences member
    WHERE member.source_id=fr.source_id AND member.netease_song_id=fr.song_id AND member.membership_status='current')`

export type RecoveryTrigger = 'manual' | 'automatic' | 'environment'
export interface RetryTarget {
  sourceId?: string | null
  songId?: number | null
  downloadTaskIds?: readonly string[]
  plexPlaylistRatingKey?: string
  plexPlaylistItemId?: number
}

export interface RecoveryTarget {
  route: 'source' | 'file' | null
  sourceId: string | null
  taskIds: string[]
  eligible: boolean
  temporary: boolean
  message?: string
}

export function sourceRecoveryTarget(sourceId: string, config: AppConfig, trigger: RecoveryTrigger): RecoveryTarget {
  const source = getSource(sourceId)
  const target: RecoveryTarget = { route: source ? 'source' : null, sourceId, taskIds: [], eligible: false, temporary: Boolean(source) }
  if (!source) return { ...target, message: '来源已不存在，请刷新后重试' }
  if (trigger !== 'manual') {
    if (!config.sync.enabled || !source.enabled) return { ...target, message: '来源或自动同步已停用' }
    if (resolveInitializationGate(source, config).action !== 'sync') return { ...target, message: '来源尚未完成首次媒体接管' }
  }
  return { ...target, eligible: true, temporary: false }
}

function activeFileCaller(taskId: string, sourceId: string | null): boolean {
  return Boolean(getDb().prepare(`SELECT 1 WHERE
    NOT EXISTS (SELECT 1 FROM run_file_tasks WHERE task_id=?) OR EXISTS (
      SELECT 1 FROM run_file_tasks caller JOIN task_runs run ON run.id=caller.run_id
      WHERE caller.task_id=? AND caller.source_id IS ? AND caller.paused=0 AND run.status<>'cancelled')`)
    .get(taskId, taskId, sourceId))
}

/** Trigger permissions differ; source membership and original file ownership do not. */
export function resolveRecoveryTarget(input: RetryTarget, config: AppConfig, trigger: RecoveryTrigger): RecoveryTarget {
  const sourceId = input.sourceId ?? null
  const unavailable = (message: string, temporary = false): RecoveryTarget => ({
    route: null, sourceId, taskIds: [], eligible: false, temporary, message,
  })
  if (sourceId && !input.songId) {
    if (input.plexPlaylistRatingKey && getSource(sourceId)?.plexPlaylistRatingKey !== input.plexPlaylistRatingKey) {
      return unavailable('该异常对应的 Plex 歌单已变化，请刷新后核对当前歌单')
    }
    return sourceRecoveryTarget(sourceId, config, trigger)
  }
  if (sourceId && input.songId) {
    const membership = getDb().prepare(`SELECT membership_status FROM playlist_source_track_occurrences
      WHERE source_id=? AND netease_song_id=? ORDER BY membership_status='current' DESC LIMIT 1`)
      .get(sourceId, input.songId) as { membership_status: string } | undefined
    if (membership?.membership_status === 'current') return sourceRecoveryTarget(sourceId, config, trigger)
    if (membership) return unavailable('歌曲已不属于当前来源')
  }
  const failed = (input.downloadTaskIds ?? []).filter(id => Boolean(getDb()
    .prepare("SELECT 1 FROM download_tasks WHERE id=? AND status='failed'").get(id)))
  const taskIds = trigger === 'manual' ? [...failed] : failed.filter(id => activeFileCaller(id, sourceId))
  return { route: failed.length ? 'file' : null, sourceId, taskIds, eligible: taskIds.length > 0,
    temporary: failed.length > 0 && !taskIds.length, message: failed.length ? '调用方已暂停或取消' : '没有可恢复的文件任务' }
}

export const ACTIVE_RECOVERY_CALLER_SQL = `(NOT EXISTS (SELECT 1 FROM run_file_tasks caller WHERE caller.task_id=task.id)
  OR EXISTS (SELECT 1 FROM run_file_tasks caller JOIN task_runs run ON run.id=caller.run_id
    WHERE caller.task_id=task.id AND caller.source_id IS problem.source_id
      AND caller.paused=0 AND run.status<>'cancelled'))`

export function inspectFileRecoveryTargets(taskId: string, config: AppConfig): RecoveryTarget[] {
  const problems = getDb().prepare(`SELECT DISTINCT problem.source_id, task.song_id,
      (${ACTIVE_RECOVERY_CALLER_SQL}) AS active_caller
    FROM failure_records problem JOIN download_tasks task ON task.id=?
    WHERE task.status='failed' AND problem.status='open'
      AND INSTR(',' || COALESCE(problem.download_task_ids,'') || ',', ',' || task.id || ',')>0`)
    .all(taskId) as { source_id: string | null; song_id: number; active_caller: number }[]
  return problems.map(problem => {
    const target = resolveRecoveryTarget({ sourceId: problem.source_id, songId: problem.song_id, downloadTaskIds: [taskId] }, config, 'automatic')
    return problem.active_caller || !target.route ? target : { ...target, eligible: false, temporary: true, message: '调用方已暂停或取消' }
  })
}

export function getFileRecoveryTargets(taskId: string, config: AppConfig): Array<{ sourceId: string | null; route: 'source' | 'file' }> {
  return inspectFileRecoveryTargets(taskId, config).flatMap(target => target.eligible && target.route
    ? [{ sourceId: target.sourceId, route: target.route }] : [])
}

export interface EnvironmentProblem {
  id: string
  sourceId: string | null
  subjectKey: string
  songId: number | null
  taskIds: string[]
  lastSeenAt: string
  occurrenceCount: number
}

export function getEnvironmentProblems(code: string, config: AppConfig): EnvironmentProblem[] {
  const rows = getDb().prepare(`SELECT id,source_id,subject_key,song_id,download_task_ids,last_seen_at,occurrence_count
    FROM failure_records WHERE status='open' AND failure_kind=?`).all(code) as Array<{
    id: string; source_id: string | null; subject_key: string; song_id: number | null;
    download_task_ids: string | null; last_seen_at: string; occurrence_count: number;
  }>
  return rows.flatMap(row => {
    const taskIds = (row.download_task_ids ?? '').split(',').filter(id => Boolean(id && getDb()
      .prepare("SELECT 1 FROM download_tasks WHERE id=? AND status='failed' AND error_code=?").get(id, code))
      && getFileRecoveryTargets(id, config).some(target => target.sourceId === row.source_id))
    const target = resolveRecoveryTarget({ sourceId: row.source_id, songId: row.song_id,
      downloadTaskIds: taskIds, ...plexRemovalTarget(row.subject_key) }, config, 'environment')
    const sourceProblem = row.source_id && row.subject_key === failureSubjectKey({ sourceId: row.source_id, songName: '来源同步' })
    if (!taskIds.length && !(target.eligible && (sourceProblem || code === 'plex_authentication_failed'))) return []
    return [{ id: row.id, sourceId: row.source_id, subjectKey: row.subject_key, songId: row.song_id, taskIds,
      lastSeenAt: row.last_seen_at, occurrenceCount: row.occurrence_count }]
  })
}
