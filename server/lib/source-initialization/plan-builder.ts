import type { QuickPlanItem, QuickPreview } from '../../../shared/quick-initialization'
import { normalizePlexPath } from '../sync/identity-store'
import type { ScoredCandidate } from './scored-candidates'

export type PlanRow = Record<string, unknown>
export interface BindingSnapshot { songId: number; version: string; path: string; key: string | null; status: string; section: string }
export interface PlanOptions { automatic?: boolean; preserveManual?: boolean; onlyDeferred?: boolean; needsReviewOnly?: boolean; conflictOnly?: boolean; firstCandidate?: boolean; selectedSongIds?: number[] }
export interface InitializationPlan { items: QuickPlanItem[]; counts: QuickPreview['counts']; histogram: number[]; automatic?: boolean; manualSelection?: boolean }

function keys(key: unknown, path: unknown): string[] {
  return [...(key ? [`key:${key}`] : []), ...(path ? [`path:${normalizePlexPath(String(path))}`] : [])]
}

/** Rank once, then index media claims; unique candidates require no pairwise song scans. */
export function buildInitializationPlan(rows: PlanRow[], bindings: BindingSnapshot[], threshold: number, options: PlanOptions = {}): InitializationPlan {
  const selectedSongIds = options.selectedSongIds ? new Set(options.selectedSongIds) : null
  const selected = rows.filter(row => {
    if (selectedSongIds && !selectedSongIds.has(Number(row.netease_song_id))) return false
    if (options.onlyDeferred && (row.tier === 'preserved' || row.decision !== 'defer')) return false
    if (options.needsReviewOnly && !['possible', 'ambiguous'].includes(String(row.tier))) return false
    if (options.conflictOnly && row.tier !== 'conflict') return false
    return !options.preserveManual || JSON.parse(String(row.evidence_json)).decisionOrigin !== 'manual'
  })
  const owners = new Map<string, Set<number>>()
  for (const binding of bindings) if (binding.status === 'active') for (const key of keys(binding.key, binding.path)) {
    if (!owners.has(key)) owners.set(key, new Set())
    owners.get(key)!.add(binding.songId)
  }
  if (options.automatic) for (const row of rows) {
    if (row.decision !== 'adopt') continue
    for (const key of keys(row.candidate_rating_key, row.candidate_file_path)) {
      if (!owners.has(key)) owners.set(key, new Set())
      owners.get(key)!.add(Number(row.netease_song_id))
    }
  }
  const histogram = Array<number>(10).fill(0)
  const allocated = new Set<string>()
  const items: QuickPlanItem[] = selected.flatMap(row => {
    const songId = Number(row.netease_song_id)
    const preserve = row.tier === 'preserved'
    const scored = JSON.parse(String(row.evidence_json)).scoredCandidates as ScoredCandidate[] | undefined
    const best = options.automatic ? scored?.find(({ candidate, recordingMatch }) =>
      recordingMatch && candidate.ratingKey && candidate.filePath && keys(candidate.ratingKey, candidate.filePath).every(key =>
        !allocated.has(key) && ![...(owners.get(key) ?? [])].some(id => id !== songId)))
      : scored?.find(value => value.score.eligible)
    if (selectedSongIds && !best) return []
    if (best) histogram[Math.min(9, Math.floor(best.score.total / 10))]!++
    const mediaKeys = best ? keys(best.candidate.ratingKey, best.candidate.filePath) : []
    const adopt = !preserve && !!best && best.score.total >= threshold
    if (adopt && options.automatic) for (const key of mediaKeys) allocated.add(key)
    return [{ songId, title: String(row.title), decision: preserve ? 'preserve' : adopt ? 'adopt' : 'download',
      origin: preserve ? 'preserved' : adopt ? (options.firstCandidate ? 'first_candidate' : ['strong_id', 'high_confidence'].includes(String(row.tier)) ? 'rule_recommended' : 'threshold_match') : 'threshold_download',
      candidate: adopt ? best!.candidate : null, score: best?.score.total ?? null, risks: [...(best?.score.risks ?? ['没有可用候选'])], sharedIds: [] }]
  })
  const claims = new Map<string, Set<number>>()
  for (const item of items) if (item.decision === 'adopt') for (const key of keys(item.candidate!.ratingKey, item.candidate!.filePath)) {
    if (!claims.has(key)) claims.set(key, new Set())
    claims.get(key)!.add(item.songId)
  }
  const counts = { preserved: 0, matched: 0, downloads: 0, shared: 0, overwritten: 0 }
  const shared = new Set<string>()
  for (const item of items) {
    if (item.decision === 'adopt') {
      const mediaKeys = keys(item.candidate!.ratingKey, item.candidate!.filePath)
      item.sharedIds = [...new Set(mediaKeys.flatMap(key => [...(claims.get(key) ?? []), ...(owners.get(key) ?? [])]))].sort((a, b) => a - b)
      if (item.sharedIds.length > 1) {
        shared.add(`${item.candidate!.ratingKey}:${item.candidate!.filePath}`)
        item.risks.push(`与歌曲 ID ${item.sharedIds.filter(id => id !== item.songId).join('、')} 共用媒体`)
      }
    }
    if (item.decision === 'preserve') counts.preserved++
    else { counts.overwritten++; if (item.decision === 'adopt') counts.matched++; else counts.downloads++ }
  }
  counts.shared = shared.size
  return { items, counts, histogram, automatic: options.automatic, manualSelection: options.firstCandidate && !options.preserveManual }
}
