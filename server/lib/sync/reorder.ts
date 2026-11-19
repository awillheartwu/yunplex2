import { playlistInsertBatches } from '../plex-client'
import { CancellationError } from './service-state'
import { classifyErrorCode } from '../domain-error'
import type { DomainErrorCode } from '../../../shared/domain-errors'
import type { PlaylistWriteProgress } from '../../../shared/playlist-write'
import { executePlaylistMutation, PlaylistMutationError, readPlaylistWriteSnapshot, recoverPlaylistMutation, type PlaylistMutationOwner, type PlaylistMutationRequest } from './playlist-mutations'
import { samePlaylistItems } from './playlist-write-snapshot'
import type { PlaylistWriteItem } from './playlist-write-state'

export type PlexItem = PlaylistWriteItem
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
  authorizedRemovalItemIds?: ReadonlySet<number> | readonly number[]
  removalProtectionReason?: string
  owner?: PlaylistMutationOwner
  onProgress?: (progress: PlaylistWriteProgress) => void
  onConfirmed?: (mutations: readonly ReorderMutation[]) => void
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

/** One occurrence-based writer for initial, incremental and reorder-only synchronization. */
export async function applyFullReorder(
  playlistRatingKey: string,
  targetOrder: string[],
  currentItems: PlexItem[],
  _sectionKey: string,
  cancelRequested: () => boolean,
  log: (level: 'warn' | 'error', msg: string) => void,
  options: ReorderOptions = {},
): Promise<ReorderResult> {
  const result: ReorderResult = { inserted: 0, removed: 0, moved: 0, preserved: 0, failures: [], mutations: [] }
  if (!options.owner) throw new Error('Plex 写入必须由来源协调流程提供身份和目标检查')
  const owner = options.owner
  let progress: PlaylistWriteProgress = { phase: 'verifying', submitted: 0, confirmed: 0, total: 0, batch: 0, batches: 0 }
  const report = (update: Partial<PlaylistWriteProgress>) => { progress = { ...progress, ...update }; options.onProgress?.({ ...progress }) }
  const check = () => { if (cancelRequested()) throw new PlexReorderCancelledError(result); owner.assertCurrent() }
  const accept = (mutations: ReorderMutation[]) => {
    result.mutations.push(...mutations)
    result.inserted += mutations.filter(item => item.action === 'insert').length
    result.moved += mutations.filter(item => item.action === 'move').length
    result.removed += mutations.filter(item => item.action === 'remove').length
    options.onConfirmed?.(mutations)
  }
  check()
  report({ phase: 'verifying' })
  let working = await readPlaylistWriteSnapshot(playlistRatingKey, owner)
  recoverPlaylistMutation(owner, playlistRatingKey, working)
  if (!samePlaylistItems(currentItems, working)) throw new PlexReorderError({ ...result, failures: [
    { action: 'move', code: 'concurrent_operation', message: 'Plex 歌单在规划或等待身份锁期间已变化，本轮未写入' },
  ] })
  const authorized = new Set(options.authorizedRemovalItemIds ?? [])
  const counts = countKeys(targetOrder)
  const seen = new Map<string, number>()
  const extras = working.filter(item => {
    const count = (seen.get(item.ratingKey) ?? 0) + 1
    seen.set(item.ratingKey, count)
    return count > (counts.get(item.ratingKey) ?? 0)
  })
  for (const item of extras.filter(item => !authorized.has(item.playlistItemId))) {
    result.preserved++
    result.mutations.push({ action: 'preserve', ...item, reason: options.removalProtectionReason ?? '未获得具体条目删除授权' })
  }
  async function apply(requests: PlaylistMutationRequest[]) {
    check()
    if (requests[0]?.action === 'insert') {
      await owner.validateInsert?.(requests[0].ratingKeys)
      check()
    }
    const latest = await readPlaylistWriteSnapshot(playlistRatingKey, owner)
    if (!samePlaylistItems(working, latest)) throw new PlexReorderError({ ...result, failures: [
      { action: requests[0]!.action, code: 'concurrent_operation', message: 'Plex 歌单发生计划外修改，已停止后续写入和删除' },
    ] })
    try {
      const observed = await executePlaylistMutation(playlistRatingKey, working, requests, owner,
        count => report({ submitted: progress.submitted + count }))
      accept(observed.mutations)
      working = observed.items
      report({ confirmed: progress.confirmed + observed.mutations.length })
      return observed.complete
    } catch (error) {
      if (error instanceof PlaylistMutationError) {
        accept(error.mutations)
        report({ confirmed: progress.confirmed + error.mutations.length,
          ...(error.code === 'plex_write_uncertain' ? { phase: 'uncertain' as const } : {}) })
      }
      if (cancelRequested() || error instanceof CancellationError) throw new PlexReorderCancelledError(result)
      const message = error instanceof Error ? error.message : String(error)
      const code = classifyErrorCode(error, 'failed_plex_insert')
      const confirmed = error instanceof PlaylistMutationError ? error.mutations : []
      for (const request of requests) {
        if (request.action === 'insert') {
          const remaining = countKeys(confirmed.flatMap(item => item.action === 'insert' ? [item.ratingKey] : []))
          for (const key of request.ratingKeys) {
            const count = remaining.get(key) ?? 0
            if (count) { remaining.set(key, count - 1); continue }
            result.failures.push({ action: 'insert', ratingKey: key, message, code })
          }
        } else if (!confirmed.some(item => item.action === request.action && 'playlistItemId' in item && item.playlistItemId === request.playlistItemId)) {
          result.failures.push({ action: request.action, playlistItemId: request.playlistItemId, message, code })
        }
      }
      if (!result.failures.length) result.failures.push({ action: requests[0]!.action, message, code })
      log('error', message)
      throw new PlexReorderError(result)
    }
  }

  const available = countKeys(working.map(item => item.ratingKey))
  const missing = targetOrder.filter(key => {
    const count = available.get(key) ?? 0
    if (!count) return true
    available.set(key, count - 1)
    return false
  })
  const batches = playlistInsertBatches(missing)
  report({ phase: 'adding', submitted: 0, confirmed: 0, total: missing.length, batch: 0, batches: batches.length })
  for (const [index, ratingKeys] of batches.entries()) {
    report({ batch: index + 1 })
    await apply([{ action: 'insert', ratingKeys }])
  }

  for (let round = 0; round < 2; round++) {
    const plan = planPlaylistMoves(working, targetOrder, round === 0)
    report({ phase: 'moving', submitted: 0, confirmed: 0, total: plan.length, batch: 0, batches: Math.ceil(plan.length / 100) })
    let aligned = true
    for (let offset = 0; offset < plan.length; offset += 100) {
      report({ batch: Math.floor(offset / 100) + 1 })
      if (!await apply(plan.slice(offset, offset + 100))) { aligned = false; break }
    }
    const validation = validatePlaylistOrder(targetOrder, working, { allowExtra: true })
    if (aligned && validation.ok) break
    if (round === 1) throw createPlaylistOrderError(validation, working, result)
    log('warn', 'Plex 已结束移动但读回停在本轮已知顺序，按实际条目再校准一次')
  }
  const removal = extras.filter(item => authorized.has(item.playlistItemId))
  report({ phase: 'removing', submitted: 0, confirmed: 0, total: removal.length, batch: 0, batches: Math.ceil(removal.length / 100) })
  for (let offset = 0; offset < removal.length; offset += 100) {
    report({ batch: Math.floor(offset / 100) + 1 })
    const complete = await apply(removal.slice(offset, offset + 100).map(item => ({ action: 'remove', playlistItemId: item.playlistItemId })))
    if (!complete) throw createPlaylistOrderError(validatePlaylistOrder(targetOrder, working, { allowExtra: false }), working, result)
  }
  report({ phase: 'verifying', submitted: 0, confirmed: 0, total: 0, batch: 0, batches: 0 })
  check()
  const final = await readPlaylistWriteSnapshot(playlistRatingKey, owner)
  if (!samePlaylistItems(working, final)) throw new PlexReorderError({ ...result, failures: [
    { action: 'move', code: 'concurrent_operation', message: '最终读回发现计划外变化，来源仍需重新协调' },
  ] })
  const validation = validatePlaylistOrder(targetOrder, final, { allowExtra: true })
  if (!validation.ok) throw createPlaylistOrderError(validation, final, result)
  check()
  return result
}

function planPlaylistMoves(items: PlexItem[], targets: string[], minimal: boolean): PlaylistMutationRequest[] {
  const ids = new Map<string, number[]>()
  items.forEach(item => { const values = ids.get(item.ratingKey) ?? []; values.push(item.playlistItemId); ids.set(item.ratingKey, values) })
  const used = new Map<string, number>()
  const targetIds = targets.map(key => { const index = used.get(key) ?? 0; used.set(key, index + 1); return ids.get(key)?.[index] })
  if (targetIds.some(id => id === undefined)) throw new Error('Plex 目标条目缺失，不能安全重排')
  const order = items.map(item => item.playlistItemId)
  const uniqueTargets = targetIds as number[]
  const stable = minimal ? computeLCS(order, uniqueTargets) : new Set<number>()
  const previous = new Map<number, number | null>()
  const next = new Map<number | null, number | null>()
  order.forEach((id, index) => {
    previous.set(id, order[index - 1] ?? null)
    next.set(id, order[index + 1] ?? null)
  })
  next.set(null, order[0] ?? null)
  const requests: PlaylistMutationRequest[] = []
  let anchor: number | null = null
  for (const id of uniqueTargets) {
    if (!stable.has(id)) {
      if (previous.get(id) !== anchor) {
        const before = previous.get(id)!
        const after = next.get(id)!
        next.set(before, after)
        if (after !== null) previous.set(after, before)
        const successor = next.get(anchor)!
        next.set(anchor, id)
        previous.set(id, anchor)
        next.set(id, successor)
        if (successor !== null) previous.set(successor, id)
        requests.push({ action: 'move', playlistItemId: id, afterPlaylistItemId: anchor })
      }
    }
    anchor = id
  }
  return requests
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

/** LCS of unique occurrence IDs via LIS of target positions: O(N log N), O(N) space. */
export function computeLCS(a: number[], b: number[]): Set<number> {
  if (new Set(a).size !== a.length || new Set(b).size !== b.length) throw new Error('重排要求唯一的 playlistItemID')
  const positions = new Map(b.map((id, index) => [id, index]))
  const sequence = a.filter(id => positions.has(id))
  const tails: number[] = []
  const previous = new Int32Array(sequence.length).fill(-1)
  sequence.forEach((id, index) => {
    const value = positions.get(id)!
    let low = 0; let high = tails.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (positions.get(sequence[tails[middle]!]!)! < value) low = middle + 1
      else high = middle
    }
    if (low > 0) previous[index] = tails[low - 1]!
    tails[low] = index
  })
  const stable = new Set<number>()
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) stable.add(sequence[index]!)
  return stable
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
