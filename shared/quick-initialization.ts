import type { InitializationCandidate } from '../server/lib/source-initialization/types'
export interface QuickPlanItem {
  songId: number; title: string; decision: 'preserve'|'adopt'|'download'; origin: 'preserved'|'rule_recommended'|'threshold_match'|'threshold_download'
  candidate: InitializationCandidate | null; score: number | null; risks: string[]; sharedIds: number[]
}
export interface QuickPreview {
  operationId: string; token: string; initializationId: string; revision: number; threshold: number; expiresAt: string
  counts: {preserved:number;matched:number;downloads:number;shared:number;overwritten:number}; histogram: number[]
  items: QuickPlanItem[]; total: number; page: number; pageSize: number
}
