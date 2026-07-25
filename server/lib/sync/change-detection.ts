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
  /** Plex playlist changed after the last recorded Plex sync */
  plexDriftDetected?: boolean
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
  plexDriftDetected: boolean
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
    currentIdOrder, trackIdSnapshot, plexDriftDetected = false,
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

  const oldIds = new Set(oldSnapshot)
  const currentIds = new Set(currentIdOrder)
  const addedIds = currentIdOrder.filter(id => !oldIds.has(id))
  const removedIds = oldSnapshot.filter(id => !currentIds.has(id))

  // Compare only the IDs shared by both snapshots. Comparing the complete
  // arrays makes every insertion/deletion look like a reorder and renders the
  // pure-addition/deletion branches unreachable.
  const previousSharedOrder = oldSnapshot.filter(id => currentIds.has(id))
  const currentSharedOrder = currentIdOrder.filter(id => oldIds.has(id))
  const sharedOrderChanged = oldSnapshot.length > 0
    && JSON.stringify(previousSharedOrder) !== JSON.stringify(currentSharedOrder)
  const isPureAddition = addedIds.length > 0 && removedIds.length === 0 && !sharedOrderChanged
  const isPureDeletion = addedIds.length === 0 && removedIds.length > 0 && !sharedOrderChanged
  const isPureReorder = addedIds.length === 0 && removedIds.length === 0 && sharedOrderChanged
  const canIncremental = isPureAddition || isPureDeletion || isPureReorder

  const changedMsg = neteaseChanged ? '网易云已变' : '未变化'
  const diffMsg = canIncremental
    ? (isPureAddition ? `+${addedIds.length}首` : isPureDeletion ? `-${removedIds.length}首` : '重排')
    : (addedIds.length || removedIds.length ? `+${addedIds.length}/-${removedIds.length}${sharedOrderChanged ? '/重排' : ''}` : '')

  // Decision: full vs incremental shortcut (albums always full)
  // Skip entirely if Netease unchanged (albums never skip)
  const skipEntirely = !isAlbum && !neteaseChanged && !plexDriftDetected && !manualForce && !autoForce && !dryRun
  const needFullCompare = !skipEntirely && (isAlbum || manualForce || autoForce || plexDriftDetected || dryRun || !canIncremental || oldSnapshot.length === 0)

  return {
    neteaseChanged, autoForce,
    isPureAddition, isPureDeletion, isPureReorder, canIncremental,
    needFullCompare, skipEntirely, plexDriftDetected,
    addedIds, removedIds, oldSnapshot,
    changedMsg, diffMsg,
  }
}
