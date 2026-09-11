import type { AppConfig } from '../config/types'
import type { PlaylistSource } from '../playlist/types'
import { effectiveInitializationEnabled, getLatestInitialization } from './store'

export type InitializationGate =
  | { action: 'sync' }
  | { action: 'analyze' }
  | { action: 'awaiting_review'; initializationId: string; runId: string | null }

export function resolveInitializationGate(source: PlaylistSource, config: AppConfig): InitializationGate {
  const latest = getLatestInitialization(source.id)
  // An explicit in-flight review cannot be bypassed by changing the default.
  if (latest && (['analyzing', 'applying', 'awaiting_review'].includes(latest.status) || (latest.status === 'pending' && ['pending', 'running'].includes(latest.requestStatus ?? '')))) {
    return { action: 'awaiting_review', initializationId: latest.id, runId: latest.runId }
  }
  if (latest?.runId && ['pending', 'failed', 'cancelled'].includes(latest.status)) return { action: 'analyze' }
  if (!effectiveInitializationEnabled(source, config)) return { action: 'sync' }
  if (!latest || ['pending', 'failed', 'cancelled'].includes(latest.status)) return { action: 'analyze' }
  if (['analyzing', 'applying', 'awaiting_review'].includes(latest.status)) {
    return { action: 'awaiting_review', initializationId: latest.id, runId: latest.runId }
  }
  return { action: 'sync' }
}

export function groupSourcesByInitializationGate(sources: PlaylistSource[], config: AppConfig): {
  analyze: PlaylistSource[]
  awaitingReview: PlaylistSource[]
  ready: PlaylistSource[]
} {
  const grouped = {
    analyze: [] as PlaylistSource[],
    awaitingReview: [] as PlaylistSource[],
    ready: [] as PlaylistSource[],
  }
  for (const source of sources) {
    const gate = resolveInitializationGate(source, config)
    if (gate.action === 'analyze') grouped.analyze.push(source)
    else if (gate.action === 'awaiting_review') grouped.awaitingReview.push(source)
    else grouped.ready.push(source)
  }
  return grouped
}

export function assertSourcesReadyForConvergence(sources: PlaylistSource[], config: AppConfig): void {
  const grouped = groupSourcesByInitializationGate(sources, config)
  const blocked = grouped.analyze.length + grouped.awaitingReview.length
  if (!blocked) return
  throw new Error(`${blocked} 个来源尚未完成首次媒体接管，普通同步已阻止`)
}
