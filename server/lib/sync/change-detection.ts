/**
 * Pure-function change detection for sync decision making.
 * Accepts all relevant source/config state and returns the sync decision.
 */
export interface ChangeDetectionInput {
  /** Whether this source is an album (albums never skip, always full compare) */
  isAlbum: boolean
  /** Netease API trackUpdateTime for current fetch */
  trackUpdateTime: number | null
  /** TrackUpdateTime from last sync (stored on source) */
  lastTrackUpdateTime: number | null | undefined
  /** Manual force flags: API forceFull || global forceFullCompare || source forceFullCompare */
  manualForce: boolean
  /** Whether dryRun mode is active */
  dryRun: boolean
  /** Current consecutive skip count */
  consecutiveSkips: number
  /** Source-level fullCompareAfterSkips (uses global if null) */
  fullCompareAfterSkips: number
  /** Source-level fullCompareAfterDays (uses global if null) */
  fullCompareAfterDays: number
  /** ISO timestamp of last full compare */
  lastFullCompareAt: string | null | undefined
  /** Current track ID order from Netease API */
  currentIdOrder: number[]
  /** Previous track ID snapshot JSON string */
  trackIdSnapshot: string | null | undefined
}

export interface ChangeDetectionResult {
  neteaseChanged: boolean
  autoForce: boolean
  isPureAddition: boolean
  isPureDeletion: boolean
  isPureReorder: boolean
  canIncremental: boolean
  needFullCompare: boolean
  skipEntirely: boolean
  addedIds: number[]
  removedIds: number[]
  oldSnapshot: number[]
  changedMsg: string
  diffMsg: string
}

export function detectChanges(input: ChangeDetectionInput): ChangeDetectionResult {
  const {
    isAlbum, trackUpdateTime, lastTrackUpdateTime, manualForce, dryRun,
    consecutiveSkips, fullCompareAfterSkips, fullCompareAfterDays, lastFullCompareAt,
    currentIdOrder, trackIdSnapshot,
  } = input

  const neteaseChanged = !trackUpdateTime || trackUpdateTime !== lastTrackUpdateTime

  // Auto-force after N skips or N days since last full compare
  let autoForce = false
  const skips = consecutiveSkips || 0
  if (fullCompareAfterSkips > 0 && skips >= fullCompareAfterSkips) autoForce = true
  if (fullCompareAfterDays > 0 && lastFullCompareAt) {
    const daysSince = (Date.now() - new Date(lastFullCompareAt).getTime()) / 86400000
    if (daysSince >= fullCompareAfterDays) autoForce = true
  }

  // Incremental diff: compare with last snapshot
  let oldSnapshot: number[] = []
  try { if (trackIdSnapshot) oldSnapshot = JSON.parse(trackIdSnapshot) } catch { /* ignore */ }

  const addedIds = currentIdOrder.filter(id => !oldSnapshot.includes(id))
  const removedIds = oldSnapshot.filter(id => !currentIdOrder.includes(id))
  const orderChanged = oldSnapshot.length > 0 && JSON.stringify(currentIdOrder) !== JSON.stringify(oldSnapshot)
  const isPureAddition = addedIds.length > 0 && removedIds.length === 0 && !orderChanged
  const isPureDeletion = addedIds.length === 0 && removedIds.length > 0 && !orderChanged
  const isPureReorder = addedIds.length === 0 && removedIds.length === 0 && orderChanged
  const canIncremental = isPureAddition || isPureDeletion || isPureReorder

  const changedMsg = neteaseChanged ? '网易云已变' : '未变化'
  const diffMsg = canIncremental
    ? (isPureAddition ? `+${addedIds.length}首` : isPureDeletion ? `-${removedIds.length}首` : '重排')
    : (addedIds.length || removedIds.length ? `+${addedIds.length}/-${removedIds.length}${orderChanged ? '/重排' : ''}` : '')

  // Decision: full vs incremental shortcut (albums always full)
  // Skip entirely if Netease unchanged (albums never skip)
  const skipEntirely = !isAlbum && !neteaseChanged && !manualForce && !autoForce && !dryRun
  const needFullCompare = !skipEntirely && (isAlbum || manualForce || autoForce || dryRun || !canIncremental || oldSnapshot.length === 0)

  return {
    neteaseChanged, autoForce,
    isPureAddition, isPureDeletion, isPureReorder, canIncremental,
    needFullCompare, skipEntirely,
    addedIds, removedIds, oldSnapshot,
    changedMsg, diffMsg,
  }
}
