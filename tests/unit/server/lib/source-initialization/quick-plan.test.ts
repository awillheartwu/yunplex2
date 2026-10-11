import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '~~/server/lib/db'
import { upsertSongIdentityBinding } from '~~/server/lib/sync/identity-store'
import { cancelQuickPlan, confirmQuickPlan, previewQuickPlan, readQuickPreview, restoreQuickPlan } from '~~/server/lib/source-initialization/quick-plan'
import {
  ensurePendingInitialization,
  getInitialization,
  replaceInitializationPlans,
  setInitializationCandidate,
  setInitializationStatus,
} from '~~/server/lib/source-initialization/store'
import type { InitializationCandidate, InitializationItemPlan, InitializationTier } from '~~/server/lib/source-initialization/types'

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-quick-plan-'))
  initDb(directory)
  const now = new Date().toISOString()
  getDb().prepare(`INSERT INTO playlist_sources (
    id, netease_playlist_id, name, enabled, netease_playlist_name, created_at, updated_at
  ) VALUES ('source-1', 1, 'Source 1', 1, 'Source 1', ?, ?),
           ('source-2', 2, 'Source 2', 1, 'Source 2', ?, ?)`)
    .run(now, now, now, now)
})

afterEach(() => {
  closeDb()
  rmSync(directory, { recursive: true, force: true })
})

interface ScoredEntry {
  candidate: InitializationCandidate
  score: {
    version: number
    total: number
    eligible: boolean
    parts: { title: number; artists: number; duration: number; album: number; track: number }
    coverage: number
    blocked: string[]
    risks: string[]
    durationDeltaMs: number | null
    completeArtists: boolean
    titleStrength: number
  }
}

interface PlanSpec {
  songId: number
  tier?: InitializationTier
  candidate?: InitializationCandidate | null
  scored?: ScoredEntry[]
}

function candidate(songId: number, overrides: Partial<InitializationCandidate> = {}): InitializationCandidate {
  return {
    ratingKey: `plex-${songId}`,
    title: `Song ${songId}`,
    artist: 'Alpha',
    album: 'Album',
    durationMs: 180_000,
    trackNumber: songId,
    filePath: `/music/${songId}.flac`,
    ...overrides,
  }
}

function scoreEntry(entryCandidate: InitializationCandidate, total: number, options: { eligible?: boolean; risks?: string[] } = {}): ScoredEntry {
  return {
    candidate: entryCandidate,
    score: {
      version: 1,
      total,
      eligible: options.eligible ?? true,
      parts: { title: 35, artists: 35, duration: 20, album: 7, track: 3 },
      coverage: 1,
      blocked: [],
      risks: options.risks ?? [],
      durationDeltaMs: 0,
      completeArtists: true,
      titleStrength: 1,
    },
  }
}

/** Leaves a draft behind exactly the way a finished analysis run does. */
function createReview(sourceId: string, specs: PlanSpec[]): string {
  const initialization = ensurePendingInitialization(sourceId, 'user')
  replaceInitializationPlans(initialization.id, specs.map((spec, index): InitializationItemPlan => {
    const rowCandidate = spec.candidate === undefined ? candidate(spec.songId) : spec.candidate
    return {
      neteaseSongId: spec.songId,
      position: index,
      occurrenceCount: 1,
      title: `Song ${spec.songId}`,
      artists: ['Alpha'],
      album: 'Album',
      trackNumber: index + 1,
      durationMs: 180_000,
      tier: spec.tier ?? 'high_confidence',
      candidate: rowCandidate,
      candidates: rowCandidate ? [rowCandidate] : [],
      evidence: spec.scored?.length
        ? { rule: 'enhanced_metadata', scoreVersion: 1, scoredCandidates: spec.scored }
        : { rule: 'no_local_candidate' },
      expectedBindingUpdatedAt: null,
      decision: 'defer',
    }
  }))
  getDb().prepare('UPDATE source_initializations SET score_version = 1, matching_data_fingerprint = ?, matching_config_fingerprint = ? WHERE id = ?')
    .run('data-fingerprint', 'config-fingerprint', initialization.id)
  setInitializationStatus(initialization.id, 'awaiting_review', { neteaseCursor: 'cursor-1' })
  return initialization.id
}

function revisionOf(initializationId: string): number {
  return getInitialization(initializationId)!.revision!
}

function operation(operationId: string): Record<string, unknown> {
  return getDb().prepare('SELECT * FROM initialization_quick_operations WHERE id = ?').get(operationId) as Record<string, unknown>
}

function item(initializationId: string, songId: number): Record<string, unknown> {
  return getDb().prepare('SELECT * FROM source_initialization_items WHERE initialization_id = ? AND netease_song_id = ?')
    .get(initializationId, songId) as Record<string, unknown>
}

function itemSnapshots(initializationId: string): Array<Record<string, unknown>> {
  return getDb().prepare(`SELECT netease_song_id, tier, decision, decision_status, candidate_rating_key, candidate_file_path, evidence_json
    FROM source_initialization_items WHERE initialization_id = ? ORDER BY position`).all(initializationId) as Array<Record<string, unknown>>
}

function quickPointer(initializationId: string): { quick_threshold: number | null; quick_operation_id: string | null } {
  return getDb().prepare('SELECT quick_threshold, quick_operation_id FROM source_initializations WHERE id = ?')
    .get(initializationId) as { quick_threshold: number | null; quick_operation_id: string | null }
}

function queueRows(sourceId: string): Array<Record<string, unknown>> {
  return getDb().prepare(`SELECT id, request_kind, trigger, follow_up_of, allow_disabled, status, initialization_id
    FROM source_sync_queue WHERE source_id = ? ORDER BY created_at`).all(sourceId) as Array<Record<string, unknown>>
}

function evidence(initializationId: string, songId: number): Record<string, unknown> {
  return JSON.parse(String(item(initializationId, songId).evidence_json)) as Record<string, unknown>
}

describe('quick plan threshold preview', () => {
  it('applies the threshold to raw float scores with inclusive 0 and 100 boundaries', () => {
    const initializationId = createReview('source-1', [
      { songId: 1, tier: 'possible', scored: [scoreEntry(candidate(1), 69.9999)] },
      { songId: 2, tier: 'possible', scored: [scoreEntry(candidate(2), 70)] },
      { songId: 3, tier: 'possible', scored: [scoreEntry(candidate(3), 100)] },
      { songId: 4, tier: 'possible', scored: [scoreEntry(candidate(4), 100, { eligible: false })] },
      { songId: 5, tier: 'possible', scored: [scoreEntry(candidate(5), 0)] },
      { songId: 6, tier: 'unmatched', candidate: null },
    ])
    const revision = revisionOf(initializationId)

    const at70 = previewQuickPlan('source-1', initializationId, revision, 70)
    expect(at70.items.map(plan => [plan.songId, plan.decision])).toEqual([
      [1, 'download'], [2, 'adopt'], [3, 'adopt'], [4, 'download'], [5, 'download'], [6, 'download'],
    ])
    expect(at70.items.map(plan => plan.score)).toEqual([69.9999, 70, 100, null, 0, null])
    expect(at70.items[1]).toMatchObject({ origin: 'threshold_match', candidate: { ratingKey: 'plex-2', filePath: '/music/2.flac' } })
    expect(at70.items[0]).toMatchObject({ decision: 'download', origin: 'threshold_download', candidate: null })
    expect(at70.items[3]?.risks).toEqual(['没有可用候选'])
    expect(at70.counts).toEqual({ preserved: 0, matched: 2, downloads: 4, shared: 0, overwritten: 6 })
    // The histogram counts every eligible best candidate, not only the adopted ones.
    expect(at70.histogram).toEqual([1, 0, 0, 0, 0, 0, 1, 1, 0, 1])

    const at0 = previewQuickPlan('source-1', initializationId, revision, 0)
    expect(at0.items.map(plan => plan.decision)).toEqual(['adopt', 'adopt', 'adopt', 'download', 'adopt', 'download'])
    expect(at0.counts).toMatchObject({ matched: 4, downloads: 2 })

    const at100 = previewQuickPlan('source-1', initializationId, revision, 100)
    expect(at100.items.map(plan => plan.decision)).toEqual(['download', 'download', 'adopt', 'download', 'download', 'download'])
    expect(at100.counts).toMatchObject({ matched: 1, downloads: 5 })

    expect(() => previewQuickPlan('source-1', initializationId, revision, 70.5)).toThrow('分数线必须是 0–100 整数')
    expect(() => previewQuickPlan('source-1', initializationId, revision, -1)).toThrow('分数线必须是 0–100 整数')
    expect(() => previewQuickPlan('source-1', initializationId, revision, 101)).toThrow('分数线必须是 0–100 整数')
    expect(() => previewQuickPlan('source-1', initializationId, revision - 1, 70)).toThrow('草案已编辑，请重新预览')
  })

  it('adopts the first eligible entry when scored candidates tie and skips blocked ones', () => {
    const tieFirst = candidate(21, { ratingKey: 'plex-21-a', filePath: '/music/21-a.flac' })
    const tieSecond = candidate(21, { ratingKey: 'plex-21-b', filePath: '/music/21-b.flac' })
    const blockedTie = candidate(22, { ratingKey: 'plex-22-blocked', filePath: '/music/22-blocked.flac' })
    const allowedTie = candidate(22, { ratingKey: 'plex-22-allowed', filePath: '/music/22-allowed.flac' })
    const initializationId = createReview('source-1', [
      {
        songId: 21,
        tier: 'possible',
        scored: [scoreEntry(tieFirst, 88, { risks: ['最高分并列，按稳定顺序选择'] }), scoreEntry(tieSecond, 88)],
      },
      {
        songId: 22,
        tier: 'possible',
        scored: [scoreEntry(blockedTie, 88, { eligible: false }), scoreEntry(allowedTie, 88, { risks: ['标题相似'] })],
      },
    ])

    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 88)

    expect(preview.items.map(plan => [plan.songId, plan.decision, plan.candidate?.ratingKey, plan.score, plan.risks])).toEqual([
      [21, 'adopt', 'plex-21-a', 88, ['最高分并列，按稳定顺序选择']],
      [22, 'adopt', 'plex-22-allowed', 88, ['标题相似']],
    ])
    expect(preview.counts).toMatchObject({ matched: 2, downloads: 0 })
  })
})

describe('quick plan confirmation', () => {
  it('downloads songs without a usable candidate and keeps verified rows untouched', () => {
    const initializationId = createReview('source-1', [
      { songId: 31, tier: 'unmatched', candidate: null },
      { songId: 32, tier: 'preserved', candidate: candidate(32), scored: [scoreEntry(candidate(32), 99)] },
      { songId: 33, tier: 'possible', scored: [scoreEntry(candidate(33), 40)] },
    ])

    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 90)
    expect(preview.items.map(plan => [plan.songId, plan.decision, plan.origin])).toEqual([
      [31, 'download', 'threshold_download'],
      [32, 'preserve', 'preserved'],
      [33, 'download', 'threshold_download'],
    ])
    expect(preview.items.find(plan => plan.songId === 32)?.candidate).toBeNull()
    expect(preview.items.find(plan => plan.songId === 31)?.risks).toEqual(['没有可用候选'])
    expect(preview.counts).toEqual({ preserved: 1, matched: 0, downloads: 2, shared: 0, overwritten: 2 })

    expect(confirmQuickPlan('source-1', preview.operationId, preview.token, false).status).toBe('saved')
    expect(queueRows('source-1')).toEqual([])
    expect(item(initializationId, 31)).toMatchObject({ decision: 'download', candidate_rating_key: null })
    expect(item(initializationId, 33)).toMatchObject({ decision: 'download', candidate_rating_key: null })
    const preservedRow = item(initializationId, 32)
    expect(preservedRow).toMatchObject({ decision: 'defer', decision_status: 'proposed', candidate_rating_key: 'plex-32' })
    expect(evidence(initializationId, 32).quickDecision).toBeUndefined()
    expect(getInitialization(initializationId)).toMatchObject({ adoptItems: 0, downloadItems: 2, deferredItems: 0 })
  })

  it('rejects a confirm whose draft was edited and never partially overwrites rows', () => {
    const initializationId = createReview('source-1', [
      { songId: 41, tier: 'high_confidence', scored: [scoreEntry(candidate(41), 95)] },
      { songId: 42, tier: 'high_confidence', scored: [scoreEntry(candidate(42), 95)] },
    ])
    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 90)

    setInitializationCandidate({
      initializationId,
      songId: 41,
      candidate: { ratingKey: 'plex-41-edited', filePath: '/music/41-edited.flac', title: 'Edited', artist: 'Alpha', album: 'Album' },
    })
    expect(revisionOf(initializationId)).toBeGreaterThan(preview.revision)

    expect(() => confirmQuickPlan('source-1', preview.operationId, preview.token, true))
      .toThrow('预览过期或草案已改变，请重新预览')

    expect(operation(preview.operationId)).toMatchObject({ status: 'preview', request_id: null, previous_json: null })
    expect(queueRows('source-1')).toEqual([])
    expect(quickPointer(initializationId)).toEqual({ quick_threshold: null, quick_operation_id: null })
    expect(item(initializationId, 41)).toMatchObject({ decision: 'adopt', candidate_rating_key: 'plex-41-edited' })
    const untouched = item(initializationId, 42)
    expect(untouched).toMatchObject({ decision: 'defer', decision_status: 'proposed', candidate_rating_key: 'plex-42' })
    expect(JSON.parse(String(untouched.evidence_json)).quickDecision).toBeUndefined()
  })

  it('rejects an expired preview and unknown tokens without writing anything', () => {
    const initializationId = createReview('source-1', [
      { songId: 51, tier: 'possible', scored: [scoreEntry(candidate(51), 95)] },
    ])
    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 90)
    getDb().prepare('UPDATE initialization_quick_operations SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), preview.operationId)

    expect(() => confirmQuickPlan('source-1', preview.operationId, preview.token, false))
      .toThrow('预览过期或草案已改变，请重新预览')
    expect(() => confirmQuickPlan('source-1', preview.operationId, 'not-the-token', false)).toThrow('快速预览不存在')
    expect(() => confirmQuickPlan('source-1', 'missing-operation', preview.token, false)).toThrow('快速预览不存在')

    expect(operation(preview.operationId)).toMatchObject({ status: 'preview', request_id: null, previous_json: null })
    expect(item(initializationId, 51).decision).toBe('defer')
    expect(queueRows('source-1')).toEqual([])
  })

  it('keeps preview tokens bound to their source and latest draft', () => {
    const initializationId = createReview('source-1', [
      { songId: 61, tier: 'possible', scored: [scoreEntry(candidate(61), 95)] },
    ])
    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 90)

    expect(() => readQuickPreview('source-2', preview.operationId, preview.token)).toThrow('快速预览不属于当前来源')
    expect(() => confirmQuickPlan('source-2', preview.operationId, preview.token, false)).toThrow('快速预览不属于当前来源')
    expect(() => restoreQuickPlan('source-2', preview.operationId, preview.token)).toThrow('快速预览不属于当前来源')
    expect(() => previewQuickPlan('source-2', initializationId, preview.revision, 90)).toThrow('接管草案已变化，请刷新')

    expect(confirmQuickPlan('source-1', preview.operationId, preview.token, false).status).toBe('saved')
  })

  it('queues exactly one initialization_apply request with allow_disabled and stays idempotent', () => {
    const initializationId = createReview('source-1', [
      { songId: 71, tier: 'possible', scored: [scoreEntry(candidate(71), 95)] },
      { songId: 72, tier: 'unmatched', candidate: null },
    ])
    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 90)

    const first = confirmQuickPlan('source-1', preview.operationId, preview.token, true)
    expect(first).toMatchObject({ operationId: preview.operationId, status: 'queued' })
    expect(first.requestId).toBeTruthy()
    expect(queueRows('source-1')).toEqual([{
      id: first.requestId,
      request_kind: 'initialization_apply',
      trigger: 'user',
      follow_up_of: `quick:${preview.operationId}`,
      allow_disabled: 1,
      status: 'pending',
      initialization_id: null,
    }])

    const repeated = confirmQuickPlan('source-1', preview.operationId, preview.token, true)
    expect(repeated).toEqual(first)
    expect(queueRows('source-1')).toHaveLength(1)
    expect(getDb().prepare("SELECT COUNT(*) count FROM source_sync_queue WHERE request_kind = 'initialization_apply'").get()).toEqual({ count: 1 })

    expect(operation(preview.operationId)).toMatchObject({ status: 'queued', request_id: first.requestId, applied_revision: revisionOf(initializationId) })
    expect(item(initializationId, 71)).toMatchObject({
      decision: 'adopt', decision_status: 'proposed', candidate_rating_key: 'plex-71', candidate_file_path: '/music/71.flac',
    })
    expect(evidence(initializationId, 71).quickDecision).toEqual({
      // sharedIds always contains the row itself; only owners beyond it count as shared.
      operationId: preview.operationId, origin: 'threshold_match', threshold: 90, score: 95, scoreVersion: 1, sharedIds: [71],
    })
    expect(item(initializationId, 72)).toMatchObject({ decision: 'download', candidate_rating_key: null })
    expect(getInitialization(initializationId)).toMatchObject({
      quickStatus: 'queued', quickThreshold: 90, adoptItems: 1, downloadItems: 1,
    })
    expect(quickPointer(initializationId)).toEqual({ quick_threshold: 90, quick_operation_id: preview.operationId })
  })
})

describe('quick plan restore', () => {
  it('restores the prior threshold and saved shared authorization across successive saves', () => {
    const shared = candidate(71)
    const id = createReview('source-1', [{songId:71,scored:[scoreEntry(shared,90)]},{songId:72,scored:[scoreEntry(shared,90)]}])
    const first = previewQuickPlan('source-1',id,revisionOf(id),85)
    confirmQuickPlan('source-1',first.operationId,first.token,false)
    const second = previewQuickPlan('source-1',id,revisionOf(id),95)
    confirmQuickPlan('source-1',second.operationId,second.token,false)
    expect(item(id,71).decision).toBe('download')
    restoreQuickPlan('source-1',second.operationId,second.token)
    expect(getInitialization(id)).toMatchObject({quickThreshold:85,savedQuickOperation:{operationId:first.operationId,token:first.token}})
    expect(evidence(id,71).quickDecision).toMatchObject({operationId:first.operationId,sharedIds:[71,72]})
    restoreQuickPlan('source-1',first.operationId,first.token)
    expect(item(id,71).decision).toBe('defer')
    expect(getInitialization(id)?.quickThreshold).toBeNull()
  })

  it('restores a saved plan while the draft is untouched', () => {
    const initializationId = createReview('source-1', [
      { songId: 81, tier: 'possible', scored: [scoreEntry(candidate(81), 95)] },
      { songId: 82, tier: 'high_confidence', scored: [scoreEntry(candidate(82), 95)] },
    ])
    const before = itemSnapshots(initializationId)
    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 90)

    expect(confirmQuickPlan('source-1', preview.operationId, preview.token, false))
      .toEqual({ operationId: preview.operationId, requestId: null, status: 'saved' })
    expect(itemSnapshots(initializationId)).not.toEqual(before)
    expect(getInitialization(initializationId)).toMatchObject({ adoptItems: 2, quickStatus: 'saved' })

    expect(restoreQuickPlan('source-1', preview.operationId, preview.token)).toEqual({ restored: true })
    expect(itemSnapshots(initializationId)).toEqual(before)
    expect(operation(preview.operationId).status).toBe('restored')
    expect(getInitialization(initializationId)).toMatchObject({ adoptItems: 0, downloadItems: 0, deferredItems: 2, quickStatus: null })
    expect(quickPointer(initializationId)).toEqual({ quick_threshold: null, quick_operation_id: null })

    expect(() => restoreQuickPlan('source-1', preview.operationId, preview.token))
      .toThrow('只能恢复尚未执行且未再次编辑的草案')
  })

  it('refuses to restore a saved plan that was edited after confirmation', () => {
    const initializationId = createReview('source-1', [
      { songId: 91, tier: 'possible', scored: [scoreEntry(candidate(91), 95)] },
      { songId: 92, tier: 'possible', scored: [scoreEntry(candidate(92), 95)] },
    ])
    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 90)
    confirmQuickPlan('source-1', preview.operationId, preview.token, false)

    setInitializationCandidate({
      initializationId,
      songId: 91,
      candidate: { ratingKey: 'plex-91-edited', filePath: '/music/91-edited.flac', title: 'Edited', artist: 'Alpha', album: 'Album' },
    })

    expect(() => restoreQuickPlan('source-1', preview.operationId, preview.token))
      .toThrow('只能恢复尚未执行且未再次编辑的草案')

    expect(item(initializationId, 91)).toMatchObject({ decision: 'adopt', candidate_rating_key: 'plex-91-edited' })
    expect(evidence(initializationId, 91).quickDecision).toBeUndefined()
    expect(evidence(initializationId, 91).decisionOrigin).toBe('manual')
    expect(evidence(initializationId, 92).quickDecision).toMatchObject({ operationId: preview.operationId })
    expect(operation(preview.operationId).status).toBe('saved')
  })
})

describe('quick plan shared media ownership', () => {
  it('cancels a queued operation without applying identities and allows a new preview', () => {
    const initializationId = createReview('source-1', [{ songId: 81, scored: [scoreEntry(candidate(81), 95)] }])
    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 85)
    const accepted = confirmQuickPlan('source-1', preview.operationId, preview.token, true)
    expect(cancelQuickPlan('source-1', initializationId)).toEqual({ cancelRequested: true })
    expect(getDb().prepare('SELECT status FROM source_sync_queue WHERE id=?').get(accepted.requestId)).toEqual({ status: 'cancelled' })
    expect(operation(preview.operationId).status).toBe('cancelled')
    expect(getDb().prepare('SELECT COUNT(*) n FROM song_identity_bindings').get()).toEqual({ n: 0 })
    expect(() => confirmQuickPlan('source-1', preview.operationId, preview.token, true)).toThrow()
    const next = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 85)
    expect(confirmQuickPlan('source-1', next.operationId, next.token, true).requestId).not.toBe(accepted.requestId)
  })

  it('reports external owners in sharedIds and rejects a stale owner snapshot', () => {
    upsertSongIdentityBinding({
      neteaseSongId: 99,
      plexSectionKey: '1',
      plexFilePath: '/music/shared.flac',
      plexRatingKey: 'plex-shared',
      bindingMethod: 'path',
      status: 'active',
      evidence: { source: 'external' },
    })
    const shared = candidate(81, { ratingKey: 'plex-shared', filePath: '/music/shared.flac' })
    const initializationId = createReview('source-1', [
      { songId: 81, tier: 'possible', scored: [scoreEntry(shared, 95)] },
      { songId: 82, tier: 'possible', scored: [scoreEntry(shared, 95)] },
    ])

    const preview = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 90)
    expect(preview.items.map(plan => [plan.songId, plan.sharedIds, plan.risks])).toEqual([
      [81, [81, 82, 99], ['与歌曲 ID 82、99 共用媒体']],
      [82, [81, 82, 99], ['与歌曲 ID 81、99 共用媒体']],
    ])
    expect(preview.counts).toMatchObject({ matched: 2, shared: 1 })

    upsertSongIdentityBinding({
      neteaseSongId: 99,
      plexSectionKey: '1',
      plexFilePath: '/music/shared-moved.flac',
      plexRatingKey: 'plex-shared-moved',
      bindingMethod: 'path',
      status: 'active',
      evidence: { source: 'external' },
    })

    expect(() => confirmQuickPlan('source-1', preview.operationId, preview.token, false))
      .toThrow('媒体身份已变化，请重新预览')
    expect(itemSnapshots(initializationId).map(row => row.decision)).toEqual(['defer', 'defer'])
    expect(operation(preview.operationId)).toMatchObject({ status: 'preview', previous_json: null })

    const refreshed = previewQuickPlan('source-1', initializationId, revisionOf(initializationId), 90)
    expect(refreshed.items.map(plan => plan.sharedIds)).toEqual([[81, 82], [81, 82]])
    expect(confirmQuickPlan('source-1', refreshed.operationId, refreshed.token, false).status).toBe('saved')
  })
})
