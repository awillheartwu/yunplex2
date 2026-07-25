import {
  insertTrackIntoPlaylist,
  getPlaylistItemIds,
  movePlaylistItemAfter,
  movePlaylistItemToTop,
  removeTrackFromPlaylist,
  getPlaylistTracks,
} from '../plex-client'

export interface PlexItem {
  ratingKey: string
  playlistItemId: number
}

export interface ReorderFailure {
  action: 'remove' | 'insert' | 'move'
  ratingKey?: string
  playlistItemId?: number
  message: string
}

export interface ReorderResult {
  inserted: number
  removed: number
  moved: number
  preserved: number
  failures: ReorderFailure[]
  mutations: ReorderMutation[]
}

export type ReorderMutation =
  | { action: 'insert'; ratingKey: string; playlistItemId: number }
  | { action: 'move'; playlistItemId: number; afterPlaylistItemId: number | null }
  | { action: 'remove'; ratingKey: string; playlistItemId: number }
  | { action: 'preserve'; ratingKey: string; playlistItemId: number; reason: string }

export interface ReorderOptions {
  /**
   * Removing a Plex playlist item is opt-in. Callers must authorize concrete
   * occurrence IDs after identity reconciliation; a ratingKey alone is not
   * sufficient because playlists can contain duplicate occurrences.
   */
  authorizedRemovalItemIds?: ReadonlySet<number> | readonly number[]
  removalProtectionReason?: string
}

export interface PlaylistOrderValidation {
  ok: boolean
  missing: string[]
  extra: string[]
  expectedTargetOrder: string[]
  currentTargetOrder: string[]
}

export class PlexReorderError extends Error {
  result: ReorderResult

  constructor(result: ReorderResult) {
    super(`Plex 歌单重排失败: ${result.failures.length} 个写入操作失败`)
    this.name = 'PlexReorderError'
    this.result = result
  }
}

/**
 * Full reorder: ensure the Plex playlist matches the target order exactly.
 *
 * Strategy (LCS-based minimal moves):
 *  1. Fetch current playlist items
 *  2. Insert missing tracks (found in library but not yet in playlist)
 *  3. Compute LCS between current order and target order
 *  4. Move out-of-LCS tracks to their correct positions
 *  5. Only after every additive operation succeeds, remove explicitly
 *     authorized extra occurrences.
 *
 * @param playlistRatingKey — Plex playlist ratingKey
 * @param targetOrder — array of plex ratingKeys in Netease playlist order
 * @param sectionKey — Plex library section key (for searchTrack fallback)
 */
export async function applyFullReorder(
  playlistRatingKey: string,
  targetOrder: string[],
  currentItems: PlexItem[],
  sectionKey: string,
  cancelRequested: () => boolean,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void,
  options: ReorderOptions = {},
): Promise<ReorderResult> {
  const result: ReorderResult = {
    inserted: 0,
    removed: 0,
    moved: 0,
    preserved: 0,
    failures: [],
    mutations: [],
  }
  const targetCounts = countKeys(targetOrder)
  const targetSet = new Set(targetOrder)
  const workingItems: PlexItem[] = [...currentItems]
  const usedItemIds = new Set(currentItems.map(item => item.playlistItemId))
  const authorizedRemovalItemIds = new Set(options.authorizedRemovalItemIds ?? [])
  const removalCandidates: PlexItem[] = []

  // Determine concrete extra occurrences, but do not mutate Plex yet. This is
  // deliberately occurrence-based: using ratingKey counts alone can delete the
  // wrong duplicate playlist item.
  const seenCurrentCounts = new Map<string, number>()
  for (const item of currentItems) {
    const seen = (seenCurrentCounts.get(item.ratingKey) ?? 0) + 1
    seenCurrentCounts.set(item.ratingKey, seen)
    const isExtraRatingKey = !targetSet.has(item.ratingKey)
    const isSurplusDuplicate = seen > (targetCounts.get(item.ratingKey) ?? 0)
    if (isExtraRatingKey || isSurplusDuplicate) {
      removalCandidates.push(item)
      if (!authorizedRemovalItemIds.has(item.playlistItemId)) {
        const reason = options.removalProtectionReason ?? '未获得逐项强身份删除授权'
        result.preserved++
        result.mutations.push({
          action: 'preserve',
          ratingKey: item.ratingKey,
          playlistItemId: item.playlistItemId,
          reason,
        })
      }
    }
  }

  // ── Step 1: Insert missing tracks ──
  const currentCounts = countKeys(workingItems.map(item => item.ratingKey))
  for (const [key, requiredCount] of targetCounts) {
    while ((currentCounts.get(key) ?? 0) < requiredCount) {
      if (cancelRequested()) return result
      try {
        await insertTrackIntoPlaylist(playlistRatingKey, key)
        const itemIds = await getPlaylistItemIds(playlistRatingKey, key)
        const itemId = [...itemIds].reverse().find(id => !usedItemIds.has(id)) ?? 0
        if (itemId) {
          workingItems.push({ ratingKey: key, playlistItemId: itemId })
          usedItemIds.add(itemId)
          currentCounts.set(key, (currentCounts.get(key) ?? 0) + 1)
          result.inserted++
          result.mutations.push({ action: 'insert', ratingKey: key, playlistItemId: itemId })
        } else {
          result.failures.push({ action: 'insert', ratingKey: key, message: 'Plex 已接受插入请求，但未返回新的 playlistItemID' })
          log('error', `插入歌单失败 (${key}): 未返回新的 playlistItemID`)
          break
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.failures.push({ action: 'insert', ratingKey: key, message: msg })
        log('error', `插入歌单失败 (${key}): ${msg}`)
        break
      }
    }
  }

  // Never remove old items if any replacement could not be inserted. The old
  // playlist remains playable and the run exposes the concrete failure.
  if (result.failures.length > 0) throw new PlexReorderError(result)

  // ── Step 2: LCS-based reorder ──
  // Current order (after insertions): array of playlistItemIds
  // Target order: array of ratingKeys
  // Map each target occurrence to one concrete Plex playlist item.
  const itemIdsByKey = new Map<string, number[]>()
  for (const item of workingItems) {
    if (!targetSet.has(item.ratingKey)) continue
    const ids = itemIdsByKey.get(item.ratingKey) ?? []
    ids.push(item.playlistItemId)
    itemIdsByKey.set(item.ratingKey, ids)
  }
  const targetItemIds: number[] = []
  for (const key of targetOrder) {
    const itemId = itemIdsByKey.get(key)?.shift()
    if (itemId) targetItemIds.push(itemId)
  }

  if (targetItemIds.length !== targetOrder.length) {
    result.failures.push({
      action: 'insert',
      message: `目标歌曲共 ${targetOrder.length} 首，但只能定位 ${targetItemIds.length} 个 Plex 歌单项`,
    })
    throw new PlexReorderError(result)
  }

  if (targetItemIds.length > 1) {
    const currentOrder = workingItems
      .filter((i) => targetSet.has(i.ratingKey))
      .map((i) => i.playlistItemId)

    const lcs = computeLCS(currentOrder, targetItemIds)

    // Items NOT in the LCS need to be repositioned. Protected extras may stay
    // interleaved; validation treats target order as a subsequence.
    let afterId: number | null = null
    let isFirst = true

    for (const itemId of targetItemIds) {
      if (cancelRequested()) return result
      if (lcs.has(itemId)) {
        afterId = itemId
        isFirst = false
        continue
      }

      try {
        const mutationAfterId = isFirst ? null : afterId
        if (isFirst) {
          await movePlaylistItemToTop(playlistRatingKey, itemId)
          isFirst = false
        } else if (afterId) {
          await movePlaylistItemAfter(playlistRatingKey, itemId, afterId)
        }
        result.moved++
        result.mutations.push({ action: 'move', playlistItemId: itemId, afterPlaylistItemId: mutationAfterId })
        afterId = itemId
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.failures.push({ action: 'move', playlistItemId: itemId, message: msg })
        log('error', `重排失败 (item ${itemId}): ${msg}`)
      }
    }
  }

  // A move failure is also a hard safety barrier. Do not delete a usable old
  // occurrence when the intended final order has not been established.
  if (result.failures.length > 0) throw new PlexReorderError(result)

  // ── Step 3: Remove explicitly authorized extra occurrences ──
  const authorizedRemovalCandidates = removalCandidates.filter(item =>
    authorizedRemovalItemIds.has(item.playlistItemId),
  )
  if (authorizedRemovalCandidates.length > 0) {
    let preRemovalValidation: PlaylistOrderValidation | null = null
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 250))
        const observedItems = (await getPlaylistTracks(playlistRatingKey, 99999))
          .map(track => ({ ratingKey: track.ratingKey }))
        preRemovalValidation = validatePlaylistOrder(targetOrder, observedItems, { allowExtra: true })
        if (preRemovalValidation.ok) break
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.failures.push({
        action: 'move',
        message: `删除前读回 Plex 歌单失败，已中止删除: ${message}`,
      })
      throw new PlexReorderError(result)
    }
    if (!preRemovalValidation?.ok) {
      result.failures.push({
        action: 'move',
        message: 'Plex 返回写入成功，但删除前读回校验未看到完整目标顺序；已中止删除',
      })
      throw new PlexReorderError(result)
    }
  }

  for (const item of authorizedRemovalCandidates) {
    if (cancelRequested()) return result
    try {
      await removeTrackFromPlaylist(playlistRatingKey, item.playlistItemId)
      result.removed++
      result.mutations.push({ action: 'remove', ratingKey: item.ratingKey, playlistItemId: item.playlistItemId })
      log('info', `从歌单移除: ${item.ratingKey} (item ${item.playlistItemId})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.failures.push({ action: 'remove', ratingKey: item.ratingKey, playlistItemId: item.playlistItemId, message: msg })
      log('error', `移除失败 (item ${item.playlistItemId}): ${msg}`)
    }
  }

  if (result.failures.length > 0) throw new PlexReorderError(result)
  return result
}

/** Compute LCS of two arrays, returning the set of items in the common subsequence */
export function computeLCS(a: number[], b: number[]): Set<number> {
  const m = a.length
  const n = b.length

  // Build LCS length table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  // Backtrack to find LCS items
  const lcs = new Set<number>()
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.add(a[i - 1]!)
      i--
      j--
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--
    } else {
      j--
    }
  }

  return lcs
}

export function validatePlaylistOrder(
  targetOrder: string[],
  currentItems: Pick<PlexItem, 'ratingKey'>[],
  options: { allowExtra: boolean },
): PlaylistOrderValidation {
  const targetSet = new Set(targetOrder)
  const currentKeys = currentItems.map(item => item.ratingKey)
  const currentTargetOrder = currentKeys.filter(key => targetSet.has(key))
  const currentCounts = countKeys(currentKeys)
  const targetCounts = countKeys(targetOrder)
  const missing = collectMissing(targetCounts, currentCounts)
  const extra = options.allowExtra ? [] : collectExtra(targetCounts, currentCounts)
  const orderMatches = options.allowExtra
    ? isSubsequence(targetOrder, currentKeys)
    : JSON.stringify(currentTargetOrder) === JSON.stringify(targetOrder)

  return {
    ok: missing.length === 0 && extra.length === 0 && orderMatches,
    missing,
    extra,
    expectedTargetOrder: targetOrder,
    currentTargetOrder,
  }
}

function countKeys(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function collectMissing(targetCounts: Map<string, number>, currentCounts: Map<string, number>): string[] {
  const missing: string[] = []
  for (const [key, targetCount] of targetCounts) {
    const deficit = targetCount - (currentCounts.get(key) ?? 0)
    for (let i = 0; i < deficit; i++) missing.push(key)
  }
  return missing
}

function collectExtra(targetCounts: Map<string, number>, currentCounts: Map<string, number>): string[] {
  const extra: string[] = []
  for (const [key, currentCount] of currentCounts) {
    const surplus = currentCount - (targetCounts.get(key) ?? 0)
    for (let i = 0; i < surplus; i++) extra.push(key)
  }
  return extra
}

function isSubsequence(targetOrder: string[], currentOrder: string[]): boolean {
  let cursor = 0
  for (const key of currentOrder) {
    if (key === targetOrder[cursor]) cursor++
    if (cursor === targetOrder.length) return true
  }
  return targetOrder.length === 0
}
