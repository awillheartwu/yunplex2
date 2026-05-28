import {
  insertTrackIntoPlaylist,
  getPlaylistItemId,
  movePlaylistItemAfter,
  movePlaylistItemToTop,
} from '../plex-client'

interface PlexItem {
  ratingKey: string
  playlistItemId: number
}

/**
 * Full reorder: ensure the Plex playlist matches the target order exactly.
 *
 * Strategy (LCS-based minimal moves):
 *  1. Fetch current playlist items
 *  2. Remove extra tracks not in target
 *  3. Insert missing tracks (found in library but not yet in playlist)
 *  4. Compute LCS between current order and target order
 *  5. Move out-of-LCS tracks to their correct positions
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
): Promise<void> {
  const targetSet = new Set(targetOrder)

  // ── Step 1: Remove extra tracks ──
  for (const item of currentItems) {
    if (cancelRequested()) return
    if (!targetSet.has(item.ratingKey)) {
      try {
        const { removeTrackFromPlaylist } = await import('../plex-client')
        await removeTrackFromPlaylist(playlistRatingKey, item.playlistItemId)
        log('info', `从歌单移除: ${item.ratingKey}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log('error', `移除失败: ${msg}`)
      }
    }
  }

  // ── Step 2: Insert missing tracks ──
  const currentKeys = new Set(currentItems.map((i) => i.ratingKey))
  for (const key of targetOrder) {
    if (cancelRequested()) return
    if (!currentKeys.has(key)) {
      try {
        await insertTrackIntoPlaylist(playlistRatingKey, key)
        const itemId = await getPlaylistItemId(playlistRatingKey, key)
        if (itemId) {
          currentItems.push({ ratingKey: key, playlistItemId: itemId })
          currentKeys.add(key)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log('error', `插入歌单失败 (${key}): ${msg}`)
      }
    }
  }

  // ── Step 3: LCS-based reorder ──
  // Current order (after removals + insertions): array of playlistItemIds
  // Target order: array of ratingKeys
  // Map target ratingKeys → their playlistItemIds in the current state
  const keyToItemId = new Map(currentItems.map((i) => [i.ratingKey, i.playlistItemId]))
  const targetItemIds = targetOrder.map((k) => keyToItemId.get(k)).filter(Boolean) as number[]

  if (targetItemIds.length <= 1) return

  const currentOrder = currentItems
    .filter((i) => targetSet.has(i.ratingKey))
    .map((i) => i.playlistItemId)

  const lcs = computeLCS(currentOrder, targetItemIds)

  // Items NOT in the LCS need to be repositioned
  // Strategy: iterate target order, for each item not in LCS, move it after the previous item
  let afterId: number | null = null
  let isFirst = true

  for (const itemId of targetItemIds) {
    if (cancelRequested()) return
    if (lcs.has(itemId)) {
      // In LCS — update anchor, no move needed
      afterId = itemId
      isFirst = false
      continue
    }

    try {
      if (isFirst) {
        await movePlaylistItemToTop(playlistRatingKey, itemId)
        isFirst = false
      } else if (afterId) {
        await movePlaylistItemAfter(playlistRatingKey, itemId, afterId)
      }
      afterId = itemId
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('error', `重排失败 (item ${itemId}): ${msg}`)
    }
  }
}

/** Compute LCS of two arrays, returning the set of items in the common subsequence */
function computeLCS(a: number[], b: number[]): Set<number> {
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
