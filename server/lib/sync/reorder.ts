import {
  insertTrackIntoPlaylist,
  getPlaylistItemIds,
  movePlaylistItemAfter,
  movePlaylistItemToTop,
  removeTrackFromPlaylist,
  getPlaylistTracks,
} from '../plex-client'
import { CancellationError } from './service-state'
import { classifyErrorCode } from '../domain-error'
import type { DomainErrorCode } from '../../../shared/domain-errors'

export interface PlexItem {
  ratingKey: string
  playlistItemId: number
}

export interface ReorderFailure {
  action: 'remove' | 'insert' | 'move'
  ratingKey?: string
  playlistItemId?: number
  message: string
  code?: DomainErrorCode
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
  readonly code: DomainErrorCode
  result: ReorderResult
  validation?: PlaylistOrderValidation

  constructor(result: ReorderResult, validation?: PlaylistOrderValidation) {
    const detail = result.failures[0]?.message
    super(`Plex 歌单重排失败: ${result.failures.length} 个写入操作失败${detail ? `；${detail}` : ''}`)
    this.name = 'PlexReorderError'
    this.code = result.failures.find(failure => failure.code === 'plex_authentication_failed')?.code
      ?? result.failures[0]?.code ?? 'failed_plex_insert'
    this.result = result
    this.validation = validation
  }
}

export class PlexReorderCancelledError extends CancellationError {
  constructor(readonly result: ReorderResult) { super() }
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
  log: (level: 'warn' | 'error', msg: string) => void,
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
  const checkCancellation = (error?: unknown) => {
    if (error instanceof CancellationError || cancelRequested()) throw new PlexReorderCancelledError(result)
  }

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
      checkCancellation()
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
        checkCancellation(err)
        const msg = err instanceof Error ? err.message : String(err)
        result.failures.push({ action: 'insert', ratingKey: key, message: msg, code: classifyErrorCode(err, 'failed_plex_insert') })
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
      checkCancellation()
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
        checkCancellation(err)
        const msg = err instanceof Error ? err.message : String(err)
        result.failures.push({ action: 'move', playlistItemId: itemId, message: msg, code: classifyErrorCode(err, 'failed_plex_insert') })
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
  if (result.moved > 0 || authorizedRemovalCandidates.length > 0) {
    const readBack = async (): Promise<PlexItem[]> => {
      try {
        return (await getPlaylistTracks(playlistRatingKey, 99999))
          .map(track => ({ ratingKey: track.ratingKey, playlistItemId: track.playlistItemID! }))
      } catch (err) {
        checkCancellation(err)
        const message = err instanceof Error ? err.message : String(err)
        result.failures.push({ action: 'move', message: `重排后读回 Plex 歌单失败: ${message}`, code: classifyErrorCode(err, 'failed_plex_insert') })
        throw new PlexReorderError(result)
      }
    }
    let observedItems = workingItems
    let validation = validatePlaylistOrder(targetOrder, observedItems, { allowExtra: true })
    for (let attempt = 0; attempt < 3; attempt++) {
      checkCancellation()
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 250))
      observedItems = await readBack()
      validation = validatePlaylistOrder(targetOrder, observedItems, { allowExtra: true })
      if (validation.ok) break
    }

    if (!validation.ok && validation.missing.length === 0) {
      // Plex can acknowledge an earlier move without placing the item before
      // its successor. Move the inverted successor later instead, once.
      const observedById = new Map(observedItems.map(item => [item.playlistItemId, item.ratingKey]))
      const changedIndex = targetItemIds.findIndex((id, index) => observedById.get(id) !== targetOrder[index])
      if (changedIndex >= 0) {
        result.failures.push({
          action: 'move',
          ratingKey: targetOrder[changedIndex],
          playlistItemId: targetItemIds[changedIndex],
          message: 'Plex 读回的具体歌单项已变化，本轮停止重排',
        })
        throw new PlexReorderError(result, validation)
      }
      log('warn', 'Plex 移动后顺序未对齐，按读回的具体条目从另一方向调整错位项')
      const observedOrder = observedItems.map(item => item.playlistItemId)
      for (let index = 1; index < targetItemIds.length; index++) {
        checkCancellation()
        const afterItemId = targetItemIds[index - 1]!
        const itemId = targetItemIds[index]!
        if (observedOrder.indexOf(afterItemId) < observedOrder.indexOf(itemId)) continue
        try {
          await movePlaylistItemAfter(playlistRatingKey, itemId, afterItemId)
          result.moved++
          result.mutations.push({ action: 'move', playlistItemId: itemId, afterPlaylistItemId: afterItemId })
          observedOrder.splice(observedOrder.indexOf(itemId), 1)
          observedOrder.splice(observedOrder.indexOf(afterItemId) + 1, 0, itemId)
        } catch (err) {
          checkCancellation(err)
          const message = err instanceof Error ? err.message : String(err)
          result.failures.push({ action: 'move', ratingKey: targetOrder[index], playlistItemId: itemId, message, code: classifyErrorCode(err, 'failed_plex_insert') })
          throw new PlexReorderError(result)
        }
      }
      checkCancellation()
      observedItems = await readBack()
      validation = validatePlaylistOrder(targetOrder, observedItems, { allowExtra: true })
    }
    if (!validation.ok) throw createPlaylistOrderError(validation, observedItems, result)
  }

  for (const item of authorizedRemovalCandidates) {
    checkCancellation()
    try {
      await removeTrackFromPlaylist(playlistRatingKey, item.playlistItemId)
    } catch (err) {
      checkCancellation(err)
      const msg = err instanceof Error ? err.message : String(err)
      result.failures.push({ action: 'remove', ratingKey: item.ratingKey, playlistItemId: item.playlistItemId, message: msg, code: classifyErrorCode(err, 'failed_plex_insert') })
      log('error', `移除失败 (item ${item.playlistItemId}): ${msg}`)
    }
  }

  if (authorizedRemovalCandidates.length) {
    checkCancellation()
    let remaining: Set<number>
    try {
      remaining = new Set((await getPlaylistTracks(playlistRatingKey, 99999)).map(track => track.playlistItemID!))
    } catch (err) {
      checkCancellation(err)
      const message = err instanceof Error ? err.message : String(err)
      for (const item of authorizedRemovalCandidates) result.failures.push({ action: 'remove', ...item, message: `删除后读回失败: ${message}`, code: classifyErrorCode(err, 'failed_plex_insert') })
      throw new PlexReorderError(result)
    }
    for (const item of authorizedRemovalCandidates) {
      if (remaining.has(item.playlistItemId)) {
        if (!result.failures.some(failure => failure.action === 'remove' && failure.playlistItemId === item.playlistItemId)) {
          result.failures.push({ action: 'remove', ...item, message: 'Plex 已接受删除请求，但具体 playlistItemID 仍存在' })
        }
      } else {
        result.failures = result.failures.filter(failure => failure.action !== 'remove' || failure.playlistItemId !== item.playlistItemId)
        result.removed++
        result.mutations.push({ action: 'remove', ...item })
      }
    }
  }

  if (result.failures.length > 0) throw new PlexReorderError(result)
  return result
}

/** Preserve concrete failed items when HTTP acknowledgements disagree with readback. */
export function createPlaylistOrderError(
  validation: PlaylistOrderValidation,
  currentItems: PlexItem[],
  result: ReorderResult,
): PlexReorderError {
  const failures: ReorderFailure[] = []
  const missing = new Set(validation.missing)
  let cursor = 0
  for (const key of validation.expectedTargetOrder) {
    const position = currentItems.findIndex((item, index) => index >= cursor && item.ratingKey === key)
    if (position >= 0) {
      cursor = position + 1
      continue
    }
    const item = currentItems.find(candidate => candidate.ratingKey === key)
    failures.push({
      action: missing.has(key) ? 'insert' : 'move',
      ratingKey: key,
      playlistItemId: item?.playlistItemId,
      message: missing.has(key)
        ? `Plex 写后校验未找到目标媒体 #${key}`
        : `Plex 写后校验发现媒体 #${key} 未按目标顺序排列`,
    })
  }
  if (validation.extra.length > 0) {
    const remainingIds = new Set(currentItems.map(item => item.playlistItemId))
    const failedRemovals = result.mutations.filter(mutation =>
      mutation.action === 'remove' && remainingIds.has(mutation.playlistItemId),
    )
    for (const mutation of failedRemovals) {
      if (mutation.action !== 'remove') continue
      failures.push({
        action: 'remove',
        ratingKey: mutation.ratingKey,
        playlistItemId: mutation.playlistItemId,
        message: `Plex 写后校验发现应移除的具体歌单项 #${mutation.playlistItemId} 仍存在`,
      })
    }
    if (failedRemovals.length === 0) failures.push({ action: 'remove',
      message: 'Plex 写后出现了未在本轮移除计划中的多余条目，请重新核对歌单成员' })
  }
  return new PlexReorderError({ ...result, failures: [...result.failures, ...failures] }, validation)
}

/**
 * Compute an LCS of two arrays, returning the set of items in the common
 * subsequence.
 *
 * Hirschberg's divide-and-conquer reconstruction keeps only two DP rows at a
 * time. The running time remains O(m * n), while auxiliary space is O(n)
 * instead of materializing an O(m * n) JavaScript array-of-arrays. The second
 * argument is the target playlist order in the production call path, so this
 * bounds memory by the configured playlist size.
 */
export function computeLCS(a: number[], b: number[]): Set<number> {
  const sequence: number[] = []
  appendLCS(a, 0, a.length, b, 0, b.length, sequence)
  return new Set(sequence)
}

function appendLCS(
  a: number[],
  aStart: number,
  aEnd: number,
  b: number[],
  bStart: number,
  bEnd: number,
  output: number[],
): void {
  if (aStart >= aEnd || bStart >= bEnd) return

  if (aEnd - aStart === 1) {
    const value = a[aStart]!
    // The previous full-table backtracking encountered the last matching
    // occurrence first, so retain that deterministic choice for duplicates.
    for (let j = bEnd - 1; j >= bStart; j--) {
      if (b[j] === value) {
        output.push(value)
        return
      }
    }
    return
  }

  const aMiddle = aStart + Math.floor((aEnd - aStart) / 2)
  const bMiddle = findLcsSplit(a, aStart, aMiddle, aEnd, b, bStart, bEnd)

  appendLCS(a, aStart, aMiddle, b, bStart, bMiddle, output)
  appendLCS(a, aMiddle, aEnd, b, bMiddle, bEnd, output)
}

function findLcsSplit(
  a: number[],
  aStart: number,
  aMiddle: number,
  aEnd: number,
  b: number[],
  bStart: number,
  bEnd: number,
): number {
  const leftLengths = computePrefixLCSLengths(a, aStart, aMiddle, b, bStart, bEnd)
  const rightLengths = computeSuffixLCSLengths(a, aMiddle, aEnd, b, bStart, bEnd)

  let splitOffset = 0
  let bestLength = -1
  for (let offset = 0; offset <= bEnd - bStart; offset++) {
    const length = leftLengths[offset]! + rightLengths[offset]!
    // Prefer the rightmost equally good split. This mirrors the old DP
    // backtracking rule, which moved upward when the two predecessor cells
    // were tied.
    if (length >= bestLength) {
      bestLength = length
      splitOffset = offset
    }
  }

  return bStart + splitOffset
}

function computePrefixLCSLengths(
  a: number[],
  aStart: number,
  aEnd: number,
  b: number[],
  bStart: number,
  bEnd: number,
): Uint32Array {
  const width = bEnd - bStart
  let previous = new Uint32Array(width + 1)
  let current = new Uint32Array(width + 1)

  for (let i = aStart; i < aEnd; i++) {
    for (let offset = 1; offset <= width; offset++) {
      current[offset] = a[i] === b[bStart + offset - 1]
        ? previous[offset - 1]! + 1
        : Math.max(previous[offset]!, current[offset - 1]!)
    }
    const completed = previous
    previous = current
    current = completed
    current.fill(0)
  }

  return previous
}

function computeSuffixLCSLengths(
  a: number[],
  aStart: number,
  aEnd: number,
  b: number[],
  bStart: number,
  bEnd: number,
): Uint32Array {
  const width = bEnd - bStart
  let previous = new Uint32Array(width + 1)
  let current = new Uint32Array(width + 1)

  for (let i = aEnd - 1; i >= aStart; i--) {
    for (let offset = width - 1; offset >= 0; offset--) {
      current[offset] = a[i] === b[bStart + offset]
        ? previous[offset + 1]! + 1
        : Math.max(previous[offset]!, current[offset + 1]!)
    }
    const completed = previous
    previous = current
    current = completed
    current.fill(0)
  }

  return previous
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
