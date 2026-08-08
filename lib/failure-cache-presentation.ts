import { parsePersistedIntegerIds } from './persisted-integer-ids'

export interface FailureCacheCounts {
  continuousFailure: number
  copyrightRestricted: number
}

export function countFailureCacheEntries(serialized: string | null | undefined): number {
  if (!serialized) return 0
  try {
    const parsed: unknown = JSON.parse(serialized)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed).length
      : 0
  } catch {
    return 0
  }
}

export function countCopyrightRestrictedEntries(serialized: string | null | undefined): number {
  return parsePersistedIntegerIds(serialized).ids.length
}

function normalizedCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function normalizeFailureCacheCounts(counts: FailureCacheCounts): FailureCacheCounts {
  return {
    continuousFailure: normalizedCount(counts.continuousFailure),
    copyrightRestricted: normalizedCount(counts.copyrightRestricted),
  }
}

export function failureCacheTotal(counts: FailureCacheCounts): number {
  const normalized = normalizeFailureCacheCounts(counts)
  return normalized.continuousFailure + normalized.copyrightRestricted
}

export function formatFailureCacheSummary(counts: FailureCacheCounts): string {
  const normalized = normalizeFailureCacheCounts(counts)
  const parts: string[] = []
  if (normalized.continuousFailure > 0) parts.push(`失败缓存 ${normalized.continuousFailure}`)
  if (normalized.copyrightRestricted > 0) parts.push(`版权受限 ${normalized.copyrightRestricted}`)
  return parts.join(' · ') || '无失败缓存或版权受限'
}

export function formatFailureCacheActionLabel(counts: FailureCacheCounts): string {
  const normalized = normalizeFailureCacheCounts(counts)
  if (failureCacheTotal(normalized) === 0) return '无失败缓存或版权受限记录'
  return `当前记录：${formatFailureCacheSummary(normalized)}。点击清除这些记录；下次同步将重新尝试对应歌曲`
}

export function formatFailureCacheClearedLabel(counts: FailureCacheCounts): string {
  const normalized = normalizeFailureCacheCounts(counts)
  return `已清除 ${failureCacheTotal(normalized)} 首歌曲的失败缓存与版权受限记录`
}

export function formatFailureCacheRetryLabel(counts: FailureCacheCounts): string {
  const normalized = normalizeFailureCacheCounts(counts)
  return `已清空 ${failureCacheTotal(normalized)} 首歌曲的失败缓存与版权受限记录（连续失败 ${normalized.continuousFailure}，版权受限 ${normalized.copyrightRestricted}），增量同步已触发`
}

/**
 * Historical run summaries are immutable. Present their former “已忽略” wording
 * with the current failure-cache semantics without rewriting stored run JSON.
 */
export function presentRunSummary(summary: string): string {
  return summary.replace(/(\d+)\s*首已忽略/g, '$1 首需关注')
}
