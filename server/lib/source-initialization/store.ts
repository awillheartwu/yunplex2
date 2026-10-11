import { matchingFingerprint } from './matching-snapshot'
import { evidenceGroups, filterMembers } from '../../../shared/review-filter-groups'
import { InitializationConflictError } from './errors'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import type { PlaylistSource } from '../playlist/types'
import type { AppConfig } from '../config/types'
import type { InitializationDecision, InitializationItemPlan, InitializationTier, SourceInitializationStatus, SourceInitializationSummary } from './types'

import { INITIALIZATION_RULE_VERSION, type InitializationItemsPage, type InitializationReviewItem } from './types'

type SummaryRow = Record<string, unknown>

function mapSummary(row: SummaryRow): SourceInitializationSummary {
  const quick = row.quick_operation_id ? getDb().prepare('SELECT id,token,status,applied_revision FROM initialization_quick_operations WHERE id=?').get(row.quick_operation_id) as {id:string;token:string;status:string;applied_revision:number}|undefined : undefined
  return {
    id: String(row.id), sourceId: String(row.source_id), runId: row.run_id ? String(row.run_id) : null,
    followUpRunId: row.follow_up_run_id ? String(row.follow_up_run_id) : null,
    trigger: String(row.trigger), status: row.status as SourceInitializationStatus,
    revision: Number(row.revision ?? 0), quickThreshold: row.quick_threshold as number | null, scoreVersion: row.score_version as number | null,
    quickStatus: quick?.status ?? null,
    savedQuickOperation: quick?.status === 'saved' && quick.applied_revision === row.revision ? {operationId:quick.id,token:quick.token} : null,
    ruleVersion: Number(row.rule_version ?? 0),
    rulesCompatible: Number(row.rule_version ?? 0) === INITIALIZATION_RULE_VERSION,
    matchingConfig: row.matching_config_json ? JSON.parse(String(row.matching_config_json)) : null,
    matchingConfigFingerprint: row.matching_config_fingerprint ? String(row.matching_config_fingerprint) : null,
    matchingDataFingerprint: row.matching_data_fingerprint ? String(row.matching_data_fingerprint) : null,
    requestId: (getDb().prepare('SELECT id FROM source_sync_queue WHERE initialization_id=?').get(row.id) as { id: string } | undefined)?.id ?? null,
    requestStatus: (getDb().prepare('SELECT status FROM source_sync_queue WHERE initialization_id=?').get(row.id) as { status: string } | undefined)?.status ?? null,
    neteaseCursor: row.netease_cursor ? String(row.netease_cursor) : null,
    plexFingerprint: row.plex_fingerprint ? String(row.plex_fingerprint) : null,
    totalItems: Number(row.total_items), preservedItems: Number(row.preserved_items), strongItems: Number(row.strong_items),
    highConfidenceItems: Number(row.high_confidence_items), possibleItems: Number(row.possible_items), ambiguousItems: Number(row.ambiguous_items),
    unmatchedItems: Number(row.unmatched_items), adoptItems: Number(row.adopt_items), downloadItems: Number(row.download_items),
    deferredItems: Number(row.deferred_items), conflictItems: Number(row.conflict_items), summary: String(row.summary || ''),
    error: row.error ? String(row.error) : null, createdAt: String(row.created_at), startedAt: row.started_at ? String(row.started_at) : null,
    analyzedAt: row.analyzed_at ? String(row.analyzed_at) : null, completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at),
  }
}

export function effectiveInitializationEnabled(source: PlaylistSource, config: AppConfig): boolean {
  return source.type === 'playlist' && (source.initializeMediaOnFirstSync ?? config.sync.initializeMediaOnFirstSync ?? true)
}

export function getLatestInitialization(sourceId: string): SourceInitializationSummary | null {
  const row = getDb().prepare('SELECT * FROM source_initializations WHERE source_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(sourceId) as SummaryRow | undefined
  return row ? mapSummary(row) : null
}

export function getInitialization(id: string): SourceInitializationSummary | null {
  const row = getDb().prepare('SELECT * FROM source_initializations WHERE id = ?').get(id) as SummaryRow | undefined
  return row ? mapSummary(row) : null
}

export function ensurePendingInitialization(sourceId: string, trigger = 'system'): SourceInitializationSummary {
  const latest = getLatestInitialization(sourceId)
  if (latest && ['pending', 'analyzing', 'awaiting_review', 'applying'].includes(latest.status)) {
    if (latest.status === 'pending' && !latest.requestId && trigger !== latest.trigger) {
      getDb().prepare('UPDATE source_initializations SET trigger = ?, updated_at = ? WHERE id = ?')
        .run(trigger, new Date().toISOString(), latest.id)
      return getInitialization(latest.id)!
    }
    return latest
  }
  const now = new Date().toISOString(); const id = randomUUID()
  getDb().prepare(`INSERT INTO source_initializations (id, source_id, trigger, status, created_at, updated_at, rule_version) VALUES (?, ?, ?, 'pending', ?, ?, ?)`)
    .run(id, sourceId, trigger, now, now, INITIALIZATION_RULE_VERSION)
  return getInitialization(id)!
}

export function listRequestedPendingInitializations(): SourceInitializationSummary[] {
  const rows = getDb().prepare(`
    SELECT * FROM source_initializations
    WHERE status = 'pending' AND trigger IN ('user','schedule','retry')
    ORDER BY created_at ASC
  `).all() as SummaryRow[]
  return rows.map(mapSummary)
}

export function setInitializationStatus(id: string, status: SourceInitializationStatus, patch: Partial<{
  runId: string | null; followUpRunId: string | null; neteaseCursor: string | null; plexFingerprint: string | null; summary: string; error: string | null
}> = {}): SourceInitializationSummary {
  const now = new Date().toISOString()
  const sets = ['status = ?', 'updated_at = ?']; const values: unknown[] = [status, now]
  const columns = { runId: 'run_id', followUpRunId: 'follow_up_run_id', neteaseCursor: 'netease_cursor', plexFingerprint: 'plex_fingerprint', summary: 'summary', error: 'error' } as const
  for (const [key, column] of Object.entries(columns) as Array<[keyof typeof columns, string]>) {
    if (patch[key] !== undefined) { sets.push(`${column} = ?`); values.push(patch[key]) }
  }
  if (status === 'analyzing') { sets.push('started_at = COALESCE(started_at, ?)'); values.push(now) }
  if (status === 'awaiting_review') { sets.push('analyzed_at = ?'); values.push(now) }
  if (['completed', 'skipped'].includes(status)) { sets.push('completed_at = ?'); values.push(now) }
  values.push(id); getDb().prepare(`UPDATE source_initializations SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getInitialization(id)!
}

export function replaceInitializationPlans(initializationId: string, plans: InitializationItemPlan[]): void {
  const db = getDb(); const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare('DELETE FROM source_initialization_items WHERE initialization_id = ?').run(initializationId)
    const insert = db.prepare(`INSERT INTO source_initialization_items (
      initialization_id, netease_song_id, position, occurrence_count, title, artists_json, album, track_number, duration_ms,
      tier, candidate_rating_key, candidate_file_path, candidate_title, candidate_artist, candidate_album, candidate_duration_ms,
      candidate_count, candidates_json, evidence_json, expected_binding_updated_at, decision, decision_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`)
    for (const plan of plans) insert.run(
      initializationId, plan.neteaseSongId, plan.position, plan.occurrenceCount, plan.title, JSON.stringify(plan.artists), plan.album,
      plan.trackNumber, plan.durationMs, plan.tier, plan.candidate?.ratingKey ?? null, plan.candidate?.filePath ?? null,
      plan.candidate?.title ?? '', plan.candidate?.artist ?? '', plan.candidate?.album ?? '', plan.candidate?.durationMs ?? null,
      plan.candidates.length, JSON.stringify(plan.candidates), JSON.stringify(plan.evidence), plan.expectedBindingUpdatedAt, plan.decision, now,
    )
    const count = (tier: InitializationTier) => plans.filter(plan => plan.tier === tier).length
    const actionablePlans = plans.filter(plan => plan.tier !== 'preserved')
    db.prepare(`UPDATE source_initializations SET total_items=?, preserved_items=?, strong_items=?, high_confidence_items=?, possible_items=?, ambiguous_items=?, unmatched_items=?, adopt_items=?, download_items=?, deferred_items=?, conflict_items=?, updated_at=? WHERE id=?`)
      .run(plans.length, count('preserved'), count('strong_id'), count('high_confidence'), count('possible'), count('ambiguous'), count('unmatched') + count('metadata_missing'), actionablePlans.filter(p => p.decision === 'adopt').length, actionablePlans.filter(p => p.decision === 'download').length, actionablePlans.filter(p => p.decision === 'defer').length, count('conflict'), now, initializationId)
  })()
}

export function queryInitializationItems(input: { initializationId: string; tier?: string; decision?: string; search?: string; page?: number; pageSize?: number }): InitializationItemsPage {
  const conditions = ['initialization_id = ?']; const params: unknown[] = [input.initializationId]
  if (input.tier) { const tiers = filterMembers(evidenceGroups, input.tier); conditions.push(`tier IN (${tiers.map(() => '?').join(',')})`); params.push(...tiers) }
  if (input.decision) { conditions.push('decision = ?'); params.push(input.decision) }
  if (input.search?.trim()) { conditions.push('(LOWER(title) LIKE ? OR LOWER(candidate_title) LIKE ? OR CAST(netease_song_id AS TEXT) LIKE ?)'); const q = `%${input.search.toLowerCase()}%`; params.push(q, q, q) }
  const where = conditions.join(' AND '); const pageSize = Math.min(Math.max(Math.trunc(input.pageSize ?? 50), 1), 100); const page = Math.max(Math.trunc(input.page ?? 1), 1)
  const total = Number((getDb().prepare(`SELECT COUNT(*) count FROM source_initialization_items WHERE ${where}`).get(...params) as { count: number }).count)
  const rows = getDb().prepare(`SELECT * FROM source_initialization_items WHERE ${where} ORDER BY position LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>
  const initialization = getInitialization(input.initializationId)
  const editable = initialization?.status === 'awaiting_review' && initialization.rulesCompatible
  const items = rows.map((row): InitializationReviewItem => {
    const base = {
      initializationId: String(row.initialization_id), neteaseSongId: Number(row.netease_song_id),
      position: Number(row.position), occurrenceCount: Number(row.occurrence_count), title: String(row.title),
      artists: JSON.parse(String(row.artists_json)) as string[], album: String(row.album),
      trackNumber: row.track_number as number | null, durationMs: row.duration_ms as number | null,
      tier: row.tier as InitializationTier,
      candidate: row.candidate_rating_key ? { ratingKey: String(row.candidate_rating_key), filePath: row.candidate_file_path as string | null,
        title: String(row.candidate_title), artist: String(row.candidate_artist), album: String(row.candidate_album),
        durationMs: row.candidate_duration_ms as number | null, trackNumber: null } : null,
      candidates: JSON.parse(String(row.candidates_json)), evidence: JSON.parse(String(row.evidence_json)),
      expectedBindingUpdatedAt: row.expected_binding_updated_at as string | null,
      decisionStatus: row.decision_status as InitializationReviewItem['decisionStatus'],
    }
    if (base.evidence.sharedMedia) base.evidence.sharedMediaFingerprint = matchingFingerprint(base.evidence.sharedMedia)
    if (base.tier === 'preserved') return { ...base, kind: 'preserved', decision: null, allowedDecisions: [], canSearch: false, unavailableReason: '保留已验证绑定，无需重新选择' }
    return { ...base, kind: 'actionable', decision: row.decision as InitializationDecision,
      allowedDecisions: editable ? (base.candidate ? ['adopt', 'download', 'defer'] : ['download', 'defer']) : [],
      canSearch: Boolean(editable), unavailableReason: editable ? null : '方案不可编辑，请刷新或重新分析' }
  })
  return { items, total, page, pageSize }
}

export function assertAwaitingReview(initializationId: string): void {
  const row = getDb().prepare('SELECT status, rule_version FROM source_initializations WHERE id = ?').get(initializationId) as { status?: string; rule_version: number } | undefined
  if (row?.status !== 'awaiting_review') throw new InitializationConflictError('当前接管方案不在等待确认状态')
  if (row.rule_version !== INITIALIZATION_RULE_VERSION) throw new InitializationConflictError('候选规则已更新，请重新分析后提交')
  const queued = getDb().prepare("SELECT 1 FROM initialization_quick_operations WHERE initialization_id=? AND status='queued'").get(initializationId)
  if (queued) throw new InitializationConflictError('快速方案已提交，正在等待后台处理')
}

export function setInitializationDecisions(input: { initializationId: string; songIds?: number[]; tier?: InitializationTier; decision: InitializationDecision }): number {
  return getDb().transaction(() => {
    assertAwaitingReview(input.initializationId)
    const conditions = ["initialization_id = ?", "tier != 'preserved'"]; const params: unknown[] = [input.initializationId]
    if (input.songIds?.length) { conditions.push(`netease_song_id IN (${input.songIds.map(() => '?').join(',')})`); params.push(...input.songIds) }
    else if (input.tier) { conditions.push('tier = ?'); params.push(input.tier) }
    else throw new Error('请选择歌曲或证据等级')
    if (input.decision === 'adopt') conditions.push('candidate_rating_key IS NOT NULL')
    const result = getDb().prepare(`UPDATE source_initialization_items SET decision = ?, decision_status = 'proposed', evidence_json=json_set(json_remove(evidence_json, '$.quickDecision'), '$.decisionOrigin', 'manual'), updated_at = ? WHERE ${conditions.join(' AND ')}`)
      .run(input.decision, new Date().toISOString(), ...params)
    refreshDecisionCounts(input.initializationId)
    return result.changes
  })()
}

export function setInitializationCandidate(input: { initializationId: string; songId: number; candidate: { ratingKey: string; filePath: string; title: string; artist: string; album: string; durationMs?: number | null } }): void {
  getDb().transaction(() => {
    assertAwaitingReview(input.initializationId)
    const existing = getDb().prepare('SELECT evidence_json FROM source_initialization_items WHERE initialization_id=? AND netease_song_id=?').get(input.initializationId, input.songId) as { evidence_json: string } | undefined
    const evidence = JSON.parse(existing?.evidence_json || '{}')
    delete evidence.sharedMedia
    delete evidence.sharedMediaConfirmed
    delete evidence.quickDecision
    evidence.decisionOrigin = 'manual'
    const result = getDb().prepare(`UPDATE source_initialization_items SET evidence_json=?, candidate_rating_key=?, candidate_file_path=?, candidate_title=?, candidate_artist=?, candidate_album=?, candidate_duration_ms=?, decision='adopt', decision_status='proposed', updated_at=? WHERE initialization_id=? AND netease_song_id=? AND tier != 'preserved'`)
      .run(JSON.stringify(evidence), input.candidate.ratingKey, input.candidate.filePath, input.candidate.title, input.candidate.artist, input.candidate.album, input.candidate.durationMs ?? null, new Date().toISOString(), input.initializationId, input.songId)
    if (!result.changes) throw new Error('初始化歌曲不存在或已有绑定不可修改')
    refreshDecisionCounts(input.initializationId)
  })()
}

export function refreshDecisionCounts(id: string): void {
  getDb().prepare(`UPDATE source_initializations SET
    adopt_items=(SELECT COUNT(*) FROM source_initialization_items WHERE initialization_id=? AND tier != 'preserved' AND decision='adopt'),
    download_items=(SELECT COUNT(*) FROM source_initialization_items WHERE initialization_id=? AND tier != 'preserved' AND decision='download'),
    deferred_items=(SELECT COUNT(*) FROM source_initialization_items WHERE initialization_id=? AND tier != 'preserved' AND decision='defer'), updated_at=? WHERE id=?`)
    .run(id, id, id, new Date().toISOString(), id)
}

export function upsertMediaDecision(sourceId: string, songId: number, disposition: 'defer' | 'download', initializationId: string): void {
  const now = new Date().toISOString()
  getDb().prepare(`INSERT INTO source_media_decisions (source_id, netease_song_id, disposition, initialization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, netease_song_id) DO UPDATE SET disposition=excluded.disposition, initialization_id=excluded.initialization_id, resolved_at=NULL, updated_at=excluded.updated_at`)
    .run(sourceId, songId, disposition, initializationId, now, now)
}

export function getActiveMediaDecisions(sourceId: string): Map<number, 'defer' | 'download'> {
  const rows = getDb().prepare('SELECT netease_song_id, disposition FROM source_media_decisions WHERE source_id = ? AND resolved_at IS NULL').all(sourceId) as Array<{ netease_song_id: number; disposition: 'defer' | 'download' }>
  return new Map(rows.map(row => [row.netease_song_id, row.disposition]))
}

export function resolveMediaDecision(sourceId: string, songId: number): void {
  getDb().prepare(`
    UPDATE source_media_decisions
    SET resolved_at = ?, updated_at = ?
    WHERE source_id = ? AND netease_song_id = ? AND resolved_at IS NULL
  `).run(new Date().toISOString(), new Date().toISOString(), sourceId, songId)
}
