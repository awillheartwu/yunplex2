import type { MatchTrace } from './types'
import type { ExtraTrackRemovalPolicy } from '../config/types'

export interface ReconciliationTarget {
  neteaseSongId: number
  plexRatingKey?: string
  matchTrace?: MatchTrace
}

export interface PlaylistOccurrence {
  ratingKey: string
  playlistItemId: number
  observationKey?: string
}

export interface KnownOccurrenceIdentity {
  neteaseSongId: number
  plexRatingKey?: string | null
}

export type RemovalDecision =
  | {
      action: 'remove'
      playlistItemId: number
      ratingKey: string
      reason:
        | 'surplus_bound_occurrence'
        | 'bound_song_not_in_target'
        | 'stable_unknown_extra'
        | 'complete_target_unknown_extra'
      neteaseSongId?: number
    }
  | {
      action: 'preserve'
      playlistItemId: number
      ratingKey: string
      reason: string
    }

export interface ReconciliationPlan {
  targetOrder: string[]
  hasIncompleteTargetOrder: boolean
  authorizedRemovalItemIds: Set<number>
  removalDecisions: RemovalDecision[]
  allowExtra: boolean
}

/**
 * Produce an occurrence-level, deletion-safe mutation plan.
 *
 * A track is removable only when one of two strong facts exists:
 * - it is a surplus occurrence of a ratingKey already backed by a durable
 *   identity in the target; or
 * - its own durable identity belongs to a Netease song that is not in this
 *   target playlist.
 *
 * Metadata similarity, absence from a title search, or a partial target order
 * never authorize deletion.
 */
export function buildReconciliationPlan(input: {
  targets: ReconciliationTarget[]
  /** Authoritative IDs from playlist.trackIds, including missing song_detail rows. */
  expectedTargetSongIds?: readonly number[]
  currentItems: PlaylistOccurrence[]
  knownCurrentIdentities?: KnownOccurrenceIdentity[]
  skipRemoveExtraTracks?: boolean
  /** Empty targets require a second identical observation before deletion. */
  allowEmptyRemoval?: boolean
  extraTrackRemovalPolicy?: ExtraTrackRemovalPolicy
  extraObservationCounts?: ReadonlyMap<string, number>
}): ReconciliationPlan {
  const targetOrder = buildStrongTargetOrder(input.targets)
  const expectedTargetSongIds = input.expectedTargetSongIds ?? input.targets.map(target => target.neteaseSongId)
  const targetSongIds = new Set(expectedTargetSongIds)
  const hasIncompleteTargetOrder = targetOrder.length !== expectedTargetSongIds.length
  const strongTargetKeys = new Set(input.targets.flatMap(target =>
    target.plexRatingKey && isStrongTargetIdentity(target.matchTrace)
      ? [target.plexRatingKey]
      : [],
  ))
  const strongTargetObservationKeys = new Set(input.currentItems.flatMap(item =>
    strongTargetKeys.has(item.ratingKey) && item.observationKey
      ? [item.observationKey]
      : [],
  ))
  const targetCounts = countKeys(targetOrder)
  const seenCounts = new Map<string, number>()
  const knownIdentityByRatingKey = new Map(
    (input.knownCurrentIdentities ?? [])
      .filter(identity => identity.plexRatingKey)
      .map(identity => [identity.plexRatingKey!, identity] as const),
  )
  const authorizedRemovalItemIds = new Set<number>()
  const removalDecisions: RemovalDecision[] = []

  for (const item of input.currentItems) {
    const seen = (seenCounts.get(item.ratingKey) ?? 0) + 1
    seenCounts.set(item.ratingKey, seen)
    const requiredCount = targetCounts.get(item.ratingKey) ?? 0
    const isExtra = requiredCount === 0 || seen > requiredCount
    if (!isExtra) continue

    if (input.skipRemoveExtraTracks) {
      removalDecisions.push(preserve(item, '已配置保留 Plex 多余歌曲'))
      continue
    }

    const isPendingCandidate = input.targets.some(target =>
      target.matchTrace?.candidate?.ratingKey === item.ratingKey,
    )
    if (isPendingCandidate) {
      removalDecisions.push(preserve(item, '该 Plex 歌单项是待审核候选，已禁止删除'))
      continue
    }

    if (expectedTargetSongIds.length === 0 && !input.allowEmptyRemoval) {
      removalDecisions.push(preserve(item, '空目标尚未经连续两次观察确认，本轮禁止删除'))
      continue
    }

    if (
      requiredCount > 0
      && seen > requiredCount
      && strongTargetKeys.has(item.ratingKey)
      && !hasIncompleteTargetOrder
    ) {
      authorizedRemovalItemIds.add(item.playlistItemId)
      removalDecisions.push({
        action: 'remove',
        playlistItemId: item.playlistItemId,
        ratingKey: item.ratingKey,
        reason: 'surplus_bound_occurrence',
      })
      continue
    }

    const knownIdentity = knownIdentityByRatingKey.get(item.ratingKey)
    if (knownIdentity && !targetSongIds.has(knownIdentity.neteaseSongId)) {
      authorizedRemovalItemIds.add(item.playlistItemId)
      removalDecisions.push({
        action: 'remove',
        playlistItemId: item.playlistItemId,
        ratingKey: item.ratingKey,
        reason: 'bound_song_not_in_target',
        neteaseSongId: knownIdentity.neteaseSongId,
      })
      continue
    }

    const removalPolicy = input.extraTrackRemovalPolicy ?? 'strict'
    if (!hasIncompleteTargetOrder && removalPolicy === 'exact') {
      authorizedRemovalItemIds.add(item.playlistItemId)
      removalDecisions.push({
        action: 'remove',
        playlistItemId: item.playlistItemId,
        ratingKey: item.ratingKey,
        reason: 'complete_target_unknown_extra',
      })
      continue
    }

    if (!hasIncompleteTargetOrder && removalPolicy === 'balanced') {
      if (!item.observationKey?.startsWith('path:')) {
        removalDecisions.push(preserve(item, 'Plex 未返回该旧条目的文件路径，无法连续验证其稳定身份'))
        continue
      }
      if (strongTargetObservationKeys.has(item.observationKey)) {
        removalDecisions.push(preserve(item, '该旧条目与当前目标共享同一 Plex 文件路径，已禁止自动移除'))
        continue
      }
      const observationCount = item.observationKey
        ? (input.extraObservationCounts?.get(item.observationKey) ?? 0)
        : 0
      if (observationCount >= 2) {
        authorizedRemovalItemIds.add(item.playlistItemId)
        removalDecisions.push({
          action: 'remove',
          playlistItemId: item.playlistItemId,
          ratingKey: item.ratingKey,
          reason: 'stable_unknown_extra',
        })
      } else {
        removalDecisions.push(preserve(
          item,
          `完整目标下连续观察第 ${Math.min(observationCount, 1)}/2 次；再次确认仍为多余项后自动移除`,
        ))
      }
      continue
    }

    if (hasIncompleteTargetOrder) {
      removalDecisions.push(preserve(item, '目标歌单尚有未建立强身份的歌曲，当前项无法安全排除'))
    } else {
      removalDecisions.push(preserve(item, '当前项缺少可审计的旧身份，不能仅因为不在目标 ratingKey 中就删除'))
    }
  }

  return {
    targetOrder,
    hasIncompleteTargetOrder,
    authorizedRemovalItemIds,
    removalDecisions,
    allowExtra: removalDecisions.some(decision => decision.action === 'preserve'),
  }
}

export function buildStrongTargetOrder(targets: readonly ReconciliationTarget[]): string[] {
  return targets.flatMap(target =>
    target.plexRatingKey && isStrongTargetIdentity(target.matchTrace)
      ? [target.plexRatingKey]
      : [],
  )
}

export function findExtraPlaylistOccurrences(
  targetOrder: readonly string[],
  currentItems: readonly PlaylistOccurrence[],
): PlaylistOccurrence[] {
  const targetCounts = countKeys(targetOrder)
  const seenCounts = new Map<string, number>()
  return currentItems.filter((item) => {
    const seen = (seenCounts.get(item.ratingKey) ?? 0) + 1
    seenCounts.set(item.ratingKey, seen)
    return seen > (targetCounts.get(item.ratingKey) ?? 0)
  })
}

function isStrongTargetIdentity(trace: MatchTrace | undefined): boolean {
  if (!trace?.identity || trace.identity.bindingStatus !== 'active') return false
  return ['path', 'mb_recording', 'metadata', 'manual', 'migrated'].includes(trace.identity.method)
}

function countKeys(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}

function preserve(item: PlaylistOccurrence, reason: string): RemovalDecision {
  return { action: 'preserve', playlistItemId: item.playlistItemId, ratingKey: item.ratingKey, reason }
}
