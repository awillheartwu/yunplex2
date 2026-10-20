import type { QuickPlanItem, QuickPreview } from '../../../shared/quick-initialization'
import { normalizePlexPath } from '../sync/identity-store'
import type { InitializationCandidate } from './types'

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
    if (selectedSongIds && (!selectedSongIds.has(Number(row.netease_song_id)) || !firstCandidate(row))) return false
    if (options.onlyDeferred && (row.tier === 'preserved' || row.decision !== 'defer')) return false
    if (options.needsReviewOnly && !['possible', 'ambiguous'].includes(String(row.tier))) return false
    if (options.conflictOnly && row.tier !== 'conflict') return false
    return !options.preserveManual || JSON.parse(String(row.evidence_json)).decisionOrigin !== 'manual'
  })
  const selectedIds = new Set(selected.map(row => Number(row.netease_song_id)))
  const unchangedClaims = new Set(rows.filter(row => !selectedIds.has(Number(row.netease_song_id)) && row.decision === 'adopt')
    .flatMap(row => keys(row.candidate_rating_key, row.candidate_file_path)))
  const owners = new Map<string, Set<number>>()
  for (const binding of bindings) if (binding.status === 'active') for (const key of keys(binding.key, binding.path)) {
    if (!owners.has(key)) owners.set(key, new Set())
    owners.get(key)!.add(binding.songId)
  }
  if (options.firstCandidate) for (const row of rows) {
    if (selectedIds.has(Number(row.netease_song_id)) || row.decision !== 'adopt') continue
    for (const key of keys(row.candidate_rating_key, row.candidate_file_path)) {
      if (!owners.has(key)) owners.set(key, new Set())
      owners.get(key)!.add(Number(row.netease_song_id))
    }
  }
  const histogram = Array<number>(10).fill(0)
  const items: QuickPlanItem[] = selected.map(row => {
    const scored = JSON.parse(String(row.evidence_json)).scoredCandidates as Array<{
      candidate: InitializationCandidate; score: { total: number; eligible: boolean; risks: string[] }
    }> | undefined
    const best = options.firstCandidate ? firstCandidate(row) : scored?.find(value => value.score.eligible)
    if (best) histogram[Math.min(9, Math.floor(best.score.total / 10))]!++
    const mediaKeys = best ? keys(best.candidate.ratingKey, best.candidate.filePath) : []
    const songId = Number(row.netease_song_id)
    const conflict = options.automatic && !options.firstCandidate && (row.tier === 'conflict' || mediaKeys.some(key => unchangedClaims.has(key)
      || [...(owners.get(key) ?? [])].some(id => id !== songId)))
    const preserve = row.tier === 'preserved'
    const adopt = !preserve && !conflict && !!best && best.score.total >= threshold
    return { songId, title: String(row.title), decision: preserve ? 'preserve' : adopt ? 'adopt' : 'download',
      origin: preserve ? 'preserved' : adopt ? (options.firstCandidate ? 'first_candidate' : ['strong_id', 'high_confidence'].includes(String(row.tier)) ? 'rule_recommended' : 'threshold_match') : 'threshold_download',
      candidate: adopt ? best!.candidate : null, score: best?.score.total ?? null, risks: [...(best?.score.risks ?? ['没有可用候选'])], sharedIds: [] }
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
      if (options.automatic && !options.firstCandidate && mediaKeys.some(key => (claims.get(key)?.size ?? 0) > 1)) {
        item.decision = 'download'; item.origin = 'threshold_download'; item.candidate = null
        item.risks.push('多个歌曲认领同一媒体，改为分别下载')
      } else {
        item.sharedIds = [...new Set(mediaKeys.flatMap(key => [...(claims.get(key) ?? []), ...(owners.get(key) ?? [])]))].sort((a, b) => a - b)
        if (item.sharedIds.length > 1) {
          shared.add(`${item.candidate!.ratingKey}:${item.candidate!.filePath}`)
          item.risks.push(`与歌曲 ID ${item.sharedIds.filter(id => id !== item.songId).join('、')} 共用媒体`)
        }
      }
    }
    if (item.decision === 'preserve') counts.preserved++
    else { counts.overwritten++; if (item.decision === 'adopt') counts.matched++; else counts.downloads++ }
  }
  counts.shared = shared.size
  return { items, counts, histogram, automatic: options.automatic, manualSelection: options.firstCandidate && !options.preserveManual }
}

function firstCandidate(row: PlanRow) {
  const evidence = JSON.parse(String(row.evidence_json))
  const scored = evidence.scoredCandidates as Array<{ candidate: InitializationCandidate; score: { total: number; risks: string[] } }> | undefined
  const first = scored?.find(value => value.candidate.ratingKey && value.candidate.filePath)
  const candidate = first?.candidate ?? (JSON.parse(String(row.candidates_json || '[]')) as InitializationCandidate[]).find(value => value.ratingKey && value.filePath)
  if (!candidate) return undefined
  return { candidate, score: { total: first?.score.total ?? 0, risks: first?.score.risks ?? [] } }
}
