import { getDb } from '../db'
import { InitializationConflictError } from './errors'
import { saveAutomaticPlan } from './quick-plan'
import { requestInitializationApply } from './requests'
import { getInitialization, getLatestInitialization, initializationSelectionIds } from './store'
import type { InitializationSelectionFilter } from './types'

export type ArrangementScope = 'default' | 'deferred' | 'needs_review' | 'conflict' | 'selected'

/** A user's quick-start choice authorizes this plan; ordinary sync keeps exact-path identity rules. */
export function arrangeInitializationPlan(sourceId: string, initializationId: string, scope: ArrangementScope = 'default', selection: { songIds?: number[]; filter?: InitializationSelectionFilter } = {}) {
  return getDb().transaction(() => {
    const initialization = getInitialization(initializationId)
    if (!initialization || initialization.sourceId !== sourceId || getLatestInitialization(sourceId)?.id !== initializationId) throw new InitializationConflictError('接管方案已变化，请刷新后重试')
    const plan = saveAutomaticPlan(sourceId, initializationId, {
      automatic: true,
      preserveManual: scope === 'default',
      onlyDeferred: scope === 'deferred',
      needsReviewOnly: scope === 'needs_review',
      conflictOnly: scope === 'conflict',
      firstCandidate: scope !== 'default' || initialization.autoProcess,
      ...(scope === 'selected' ? { selectedSongIds: initializationSelectionIds(initializationId, selection) } : {}),
    })
    const manualDeferred = getDb().prepare("SELECT 1 FROM source_initialization_items WHERE initialization_id=? AND tier!='preserved' AND decision='defer' AND json_extract(evidence_json,'$.decisionOrigin')='manual' LIMIT 1").get(initializationId)
    const started = scope === 'default' && Boolean(initialization.autoProcess) && !manualDeferred
    if (started) {
      const request = requestInitializationApply(sourceId, initializationId)
      getDb().prepare("UPDATE initialization_quick_operations SET status='queued',request_id=? WHERE id=?").run(request.requestId, plan.operationId)
    }
    return { changed: plan.counts.overwritten, matched: plan.counts.matched, downloads: plan.counts.downloads, started }
  })()
}
