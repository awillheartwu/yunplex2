import { getDb } from '../db'
import { getRun } from '../run/store'
import { getSyncServiceInstance } from '../sync/instance'
import { STAGE_LABELS } from '../sync/service-state'
import { getInitializationApplyRequest } from '../sync/request-store'
import type { SourceInitializationSummary } from './types'
import type { DeferredInitializationGroup, InitializationProcessing } from '../../../shared/source-onboarding'

export function deferredInitializationGroups(initializationId: string): DeferredInitializationGroup[] {
  const rows = getDb().prepare("SELECT tier,COUNT(*) count FROM source_initialization_items WHERE initialization_id=? AND tier!='preserved' AND decision='defer' GROUP BY tier")
    .all(initializationId) as Array<{ tier: string; count: number }>
  const groups = [
    { key: 'recommended', tiers: ['strong_id', 'high_confidence'], label: '推荐候选尚未采用', explanation: '可以直接采用推荐候选，或交给系统自动安排。' },
    { key: 'needs_review', tiers: ['possible', 'ambiguous'], label: '需要核对的歌曲尚未安排', explanation: '采用当前排序的第一个候选，不因艺人或版本差异改成下载。' },
    { key: 'no_candidate', tiers: ['unmatched'], label: '未自动匹配的歌曲', explanation: '有候选就采用第一项，没有候选的才安排下载。' },
    { key: 'metadata_missing', tiers: ['metadata_missing'], label: '网易云歌曲信息不完整', explanation: '会尝试重新获取歌曲信息并下载，仍不可用的歌曲会明确列入待处理。' },
    { key: 'conflict', tiers: ['conflict'], label: '媒体关联存在冲突', explanation: '按你的选择采用第一个候选；多首歌曲可以共用该文件，各自保留歌单位置。' },
  ]
  return groups.map(group => ({ key: group.key, label: group.label, explanation: group.explanation,
    count: rows.filter(row => group.tiers.includes(row.tier)).reduce((sum, row) => sum + row.count, 0),
  })).filter(group => group.count > 0)
}

export function initializationProcessing(initialization: SourceInitializationSummary | null): InitializationProcessing | null {
  if (!initialization) return null
  const db = getDb()
  const request = db.prepare('SELECT status,run_id,last_error FROM source_sync_queue WHERE follow_up_of=?')
    .get(initialization.id) as { status: string; run_id: string | null; last_error: string | null } | undefined
  const apply = !request ? getInitializationApplyRequest(initialization.id) : undefined
  if (!request && !apply && !initialization.followUpRunId) return null
  const total = (db.prepare('SELECT COALESCE(SUM(occurrence_count),0) total FROM source_initialization_items WHERE initialization_id=?')
    .get(initialization.id) as { total: number }).total
  const runId = request?.run_id ?? initialization.followUpRunId
  const service = getSyncServiceInstance()
  const state = service.getState()
  const live = runId && state.isRunning && state.currentRunId === runId ? service.getCurrentRun() : null
  const run = live ?? (runId ? getRun(runId) : null)
  const active = Boolean(live) || ['pending', 'running'].includes(request?.status ?? apply?.status ?? '')
  const synced = Math.min(total, (run?.successSongs ?? 0) + (run?.skippedSongs ?? 0))
  let status: InitializationProcessing['status'] = active ? (request?.status === 'running' ? 'running' : 'queued') : 'failed'
  if (!active && (!request || request.status === 'completed') && run) {
    status = run.status === 'cancelled' ? 'cancelled' : run.status === 'failed' ? 'failed'
      : run.status === 'success' && synced === total ? 'success' : 'partial'
  } else if (!active && (request?.status === 'cancelled' || apply?.status === 'cancelled')) status = 'cancelled'
  return {
    active, status, runId: runId ?? null, total, synced, failed: run?.failedSongs ?? 0,
    remaining: Math.max(0, total - synced),
    stage: live ? STAGE_LABELS[state.currentStage] ?? '正在同步' : request ? '等待开始同步' : '应用歌曲安排',
    error: request?.last_error ?? apply?.last_error ?? null,
  }
}
