import { quickMediaPermissions } from './quick-permissions'
import { sharedMediaPermissions } from './shared-media'
import { InitializationConflictError } from './errors'
import { createHash, randomUUID } from 'node:crypto'
import { readConfigFromDb, getDb } from '../db'
import { fetchPlaylistSongs } from '../netease'
import { getSectionKey, getSectionTracks, initPlexClient } from '../plex-client'
import { getSource } from '../playlist/store'
import { getRun, saveRun } from '../run/store'
import { acquireIdentityMutationLock } from '../sync/identity-coordinator'
import { getInitializationIdentityBindings, normalizePlexPath, rebindSongIdentity, BindingIdentityConflictError, BindingVersionConflictError } from '../sync/identity-store'
import type { TaskRun, TaskRunTrigger } from '../job/types'
import { INITIALIZATION_RULE_VERSION, type InitializationCommitResult } from './types'
import { requestSourceInitialization } from './requests'
import { persistSourceRequest } from '../sync/request-store'
import { buildInitializationPlans } from './candidate-engine'
import { captureMatchingPolicy, matchingFingerprint } from './matching-snapshot'
import { resolveMusicBrainzAliases } from './musicbrainz-aliases'
import { ensurePendingInitialization, getInitialization, getLatestInitialization, replaceInitializationPlans, setInitializationStatus, upsertMediaDecision } from './store'

const running = new Map<string, AbortController>()

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function taskRun(input: { id?: string; trigger: TaskRunTrigger; sourceId: string; sourceName: string; status: TaskRun['status']; summary: string; total?: number; success?: number; skipped?: number; failed?: number }): TaskRun {
  const now = new Date().toISOString()
  return {
    id: input.id ?? randomUUID().slice(0, 12), type: 'source_initialization', trigger: input.trigger,
    startedAt: now, finishedAt: input.status === 'running' || input.status === 'awaiting_action' ? null : now,
    status: input.status, durationMs: 0, summary: input.summary, source: input.sourceName, sourceIds: [input.sourceId], target: 'Plex 媒体库',
    totalSongs: input.total ?? 0, successSongs: input.success ?? 0, failedSongs: input.failed ?? 0, skippedSongs: input.skipped ?? 0,
    removedSongs: 0, warnings: 0, dryRun: true, steps: [], songs: [], config: {},
  }
}

export async function analyzeSourceInitialization(sourceId: string, trigger: TaskRunTrigger = 'user', expectedInitializationId?: string): Promise<{ initializationId: string; runId: string }> {
  const source = getSource(sourceId)
  if (!source || source.type !== 'playlist') throw new Error('首次媒体接管仅支持歌单来源')
  if (running.has(sourceId)) throw new Error('该来源的首次媒体接管正在分析')
  const initialization = expectedInitializationId ? getInitialization(expectedInitializationId) : ensurePendingInitialization(sourceId, trigger)
  if (!initialization || initialization.sourceId !== sourceId || getLatestInitialization(sourceId)?.id !== initialization.id) throw new Error('接管分析请求已过期')
  if (initialization.status === 'applying') throw new InitializationConflictError('首次媒体接管方案正在应用')
  if (expectedInitializationId && !['pending', 'analyzing', 'awaiting_review'].includes(initialization.status)) throw new Error('接管分析请求已结束')
  if (initialization.status === 'awaiting_review') return { initializationId: initialization.id, runId: initialization.runId! }
  const controller = new AbortController(); running.set(sourceId, controller)
  const previousRun = initialization.runId ? getRun(initialization.runId) : null
  const run = { ...(previousRun ?? taskRun({ trigger, sourceId, sourceName: source.name, status: 'running', summary: '正在分析首次媒体接管候选' })), status: 'running' as const, startedAt: new Date().toISOString(), finishedAt: null, summary: '正在分析首次媒体接管候选' }
  saveRun(run); setInitializationStatus(initialization.id, 'analyzing', { runId: run.id, error: null })
  try {
    const config = readConfigFromDb(); controller.signal.throwIfAborted()
    const policy = captureMatchingPolicy(config)
    const [playlist] = await Promise.all([fetchPlaylistSongs(source.neteasePlaylistId, source.syncLimit ?? config.sync.songLimit, config.netease.cookie, { preserveArtistNames: true })])
    controller.signal.throwIfAborted()
    await initPlexClient(config.plex)
    const sectionKey = await getSectionKey(config.plex.section)
    if (!sectionKey) throw new Error('未找到 Plex 音乐库分区')
    const tracks = await getSectionTracks(sectionKey); controller.signal.throwIfAborted()
    const bindings = getInitializationIdentityBindings(playlist.songs.map(song => song.id))
    let plans = buildInitializationPlans({ songs: playlist.songs, tracks, bindings, aliases: policy.legacyAliases, matching: policy.config })
    if (policy.config.enabled && policy.config.musicBrainzAliases && policy.config.useArtistAliases) {
      policy.musicBrainz = await resolveMusicBrainzAliases(plans, policy.config, controller.signal)
      controller.signal.throwIfAborted()
      plans = buildInitializationPlans({ songs: playlist.songs, tracks, bindings, aliases: policy.legacyAliases, matching: policy.config, musicBrainz: policy.musicBrainz })
    }
    const knownIds = new Set(plans.map(plan => plan.neteaseSongId))
    playlist.trackIds.forEach((track, position) => {
      if (knownIds.has(track.id)) return
      plans.push({ neteaseSongId: track.id, position, occurrenceCount: 1, title: '', artists: [], album: '', trackNumber: null, durationMs: null, tier: 'metadata_missing', candidate: null, candidates: [], evidence: { rule: 'netease_metadata_missing' }, expectedBindingUpdatedAt: null, decision: 'defer' })
    })
    plans.sort((a, b) => a.position - b.position)
    getDb().transaction(() => {
      getDb().prepare('UPDATE source_initializations SET rule_version=? WHERE id=?').run(INITIALIZATION_RULE_VERSION, initialization.id)
      getDb().prepare('UPDATE source_initializations SET matching_config_json=?, matching_config_fingerprint=?, matching_data_fingerprint=? WHERE id=?')
        .run(JSON.stringify(policy), matchingFingerprint(policy), matchingFingerprint({ songs: playlist.songs, trackIds: playlist.trackIds, tracks }), initialization.id)
      replaceInitializationPlans(initialization.id, plans)
      getDb().prepare('UPDATE source_initializations SET score_version=1 WHERE id=?').run(initialization.id)
      const neteaseCursor = fingerprint(playlist.trackIds.map(track => track.id))
      const plexFingerprint = fingerprint(tracks.map(track => [track.ratingKey, track.Media?.flatMap(media => media.Part?.map(part => part.file) ?? [])]))
      const summary = `分析完成：${plans.length} 首，${plans.filter(plan => plan.tier === 'strong_id').length} 首强身份，${plans.filter(plan => plan.tier === 'high_confidence').length} 首高置信`
      const reviewed = setInitializationStatus(initialization.id, 'awaiting_review', { neteaseCursor, plexFingerprint, summary })
      const durationMs = reviewed.analyzedAt
        ? Math.max(0, Date.parse(reviewed.analyzedAt) - Date.parse(run.startedAt))
        : 0
      saveRun({ ...run, status: 'awaiting_action', durationMs, summary, totalSongs: plans.length, skippedSongs: plans.filter(plan => plan.tier === 'preserved').length })
    })()
    return { initializationId: initialization.id, runId: run.id }
  } catch (error) {
    const cancelled = controller.signal.aborted
    const summary = cancelled ? '首次媒体接管分析已取消' : '首次媒体接管分析失败'
    setInitializationStatus(initialization.id, cancelled ? 'cancelled' : 'failed', { summary, error: cancelled ? null : error instanceof Error ? error.message : String(error) })
    saveRun({ ...run, status: cancelled ? 'cancelled' : 'failed', finishedAt: new Date().toISOString(), summary, failedSongs: cancelled ? 0 : 1 })
    throw error
  } finally {
    running.delete(sourceId)
  }
}

/** Submit durable work; only the source consumer executes analysis. */
export function enqueueSourceInitialization(sourceId: string, trigger: TaskRunTrigger = 'user') {
  return requestSourceInitialization(sourceId, trigger)
}

export function cancelSourceInitialization(sourceId: string): boolean {
  const controller = running.get(sourceId)
  if (controller) { controller.abort(new Error('用户取消')); return true }
  return getDb().transaction(() => {
    const initialization = getLatestInitialization(sourceId)
    if (!initialization || initialization.status !== 'pending') return false
    const now = new Date().toISOString()
    const cancelled = getDb().prepare("UPDATE source_sync_queue SET status='cancelled', finished_at=?, updated_at=? WHERE initialization_id=? AND status='pending'").run(now, now, initialization.id)
    if (!cancelled.changes) return false
    setInitializationStatus(initialization.id, 'cancelled', { summary: '用户取消分析' })
    const run = initialization.runId ? getRun(initialization.runId) : null
    if (run) saveRun({ ...run, status: 'cancelled', finishedAt: now, summary: '用户取消分析' })
    return true
  })()
}

export function stopInitializationAnalyses(): void {
  for (const controller of running.values()) controller.abort(new Error('服务停止'))
}

async function applySourceInitialization(initializationId: string, allowDisabled = false): Promise<InitializationCommitResult> {
  const initialization = getInitialization(initializationId)
  if (initialization?.status === 'completed') {
    const row = getDb().prepare('SELECT commit_result_json FROM source_initializations WHERE id=?').get(initializationId) as { commit_result_json: string | null }
    if (row.commit_result_json) return JSON.parse(row.commit_result_json) as InitializationCommitResult
    throw new Error('旧版已完成方案不能重复提交，请刷新查看结果')
  }
  if (!initialization || getLatestInitialization(initialization.sourceId)?.id !== initialization.id || initialization.status !== 'awaiting_review') throw new InitializationConflictError('当前接管方案不在等待确认状态')
  if (!initialization.rulesCompatible) throw new InitializationConflictError('候选规则已更新，请重新分析后提交')
  const source = getSource(initialization.sourceId)
  if (!source) throw new Error('歌单来源不存在')
  setInitializationStatus(initialization.id, 'applying', { error: null })
  const config = readConfigFromDb()
  await initPlexClient(config.plex)
  const sectionKey = await getSectionKey(config.plex.section)
  if (!sectionKey) throw new Error('未找到 Plex 音乐库分区')
  const playlist = await fetchPlaylistSongs(source.neteasePlaylistId, source.syncLimit ?? config.sync.songLimit, config.netease.cookie)
  if (fingerprint(playlist.trackIds.map(track => track.id)) !== initialization.neteaseCursor) {
    setInitializationStatus(initialization.id, 'awaiting_review', { error: '网易云歌单已变化，请重新扫描后提交' })
    throw new InitializationConflictError('网易云歌单已变化，请重新扫描后提交')
  }
  const rows = getDb().prepare(`SELECT * FROM source_initialization_items WHERE initialization_id = ? AND tier != 'preserved' ORDER BY position`).all(initialization.id) as Array<Record<string, unknown>>
  const currentTracks = await getSectionTracks(sectionKey)
  const trackByRatingKey = new Map(currentTracks.map(track => [String(track.ratingKey), track]))
  const release = await acquireIdentityMutationLock()
  let applied = 0; let deferred = 0; let downloads = 0; let conflicts = 0
  let summary = ''
  let result!: InitializationCommitResult
  try {
    const db = getDb()
    db.transaction(() => {
      const cancelledQuick = db.prepare("SELECT 1 FROM initialization_quick_operations op JOIN source_sync_queue q ON q.id=op.request_id WHERE op.initialization_id=? AND op.status='queued' AND q.cancel_requested_at IS NOT NULL").get(initialization.id)
      if (cancelledQuick) throw new InitializationConflictError('快速处理已取消')
      const currentSource = getSource(source.id)
      if (!currentSource) throw new Error('歌单来源不存在')
      const sharedPermissions = new Map([...sharedMediaPermissions(initialization.id), ...quickMediaPermissions(initialization.id)])
      // Validate every selected member before any shared identity is written.
      for (const [songId, peers] of [...sharedPermissions]) {
        const valid = peers.every(id => {
          const peer = rows.find(row => Number(row.netease_song_id) === id)
          if (!peer) return true // Existing owners were version/path checked by the permission builder.
          const track = trackByRatingKey.get(String(peer.candidate_rating_key || ''))
          const paths = track?.Media?.flatMap(media => media.Part?.flatMap(part => part.file ? [part.file] : []) ?? []) ?? []
          return paths.length === 1 && normalizePlexPath(paths[0]!) === normalizePlexPath(String(peer.candidate_file_path || ''))
        })
        if (!valid) for (const id of peers) sharedPermissions.delete(id)
        if (!valid) sharedPermissions.delete(songId)
      }
      for (const row of rows) {
        const songId = Number(row.netease_song_id); const decision = String(row.decision)
        if (decision === 'defer') {
          upsertMediaDecision(source.id, songId, 'defer', initialization.id); deferred++
          db.prepare("UPDATE source_initialization_items SET decision_status='deferred', updated_at=? WHERE initialization_id=? AND netease_song_id=?").run(new Date().toISOString(), initialization.id, songId)
          continue
        }
        if (decision === 'download') {
          upsertMediaDecision(source.id, songId, 'download', initialization.id); downloads++
          db.prepare("UPDATE source_initialization_items SET decision_status='applied', updated_at=? WHERE initialization_id=? AND netease_song_id=?").run(new Date().toISOString(), initialization.id, songId)
          continue
        }
        try {
          const sharedEvidence = JSON.parse(String(row.evidence_json || '{}'))
          if ((sharedEvidence.sharedMedia || sharedEvidence.quickDecision?.origin === 'threshold_match' || sharedEvidence.quickDecision?.origin === 'rule_recommended') && !sharedPermissions.has(songId)) throw new BindingVersionConflictError()
          const ratingKey = String(row.candidate_rating_key || '')
          const track = ratingKey ? trackByRatingKey.get(ratingKey) : null
          const filePath = track?.Media?.flatMap(media => media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [])[0]
          if (!track || !filePath || normalizePlexPath(filePath) !== normalizePlexPath(String(row.candidate_file_path || ''))) throw new BindingVersionConflictError()
          rebindSongIdentity({ neteaseSongId: songId, sharedWithSongIds: sharedPermissions.get(songId), expectedBindingUpdatedAt: row.expected_binding_updated_at ? String(row.expected_binding_updated_at) : null, sourceId: source.id, binding: { plexSectionKey: sectionKey, plexSectionRoot: config.download.plexLibraryPathPrefix, plexFilePath: filePath, plexRatingKey: ratingKey, evidence: { selectedBy: 'user', source: 'first_media_adoption', initializationId: initialization.id, tier: row.tier, sharedMedia: sharedEvidence.sharedMedia ?? null, sharedMediaConfirmed: sharedEvidence.sharedMediaConfirmed ?? null, quickDecision: sharedEvidence.quickDecision ?? null } } })
          db.prepare('DELETE FROM source_media_decisions WHERE source_id=? AND netease_song_id=?').run(source.id, songId)
          db.prepare("UPDATE source_initialization_items SET decision_status='applied', updated_at=? WHERE initialization_id=? AND netease_song_id=?").run(new Date().toISOString(), initialization.id, songId)
          applied++
        } catch (error) {
          if (!(error instanceof BindingVersionConflictError) && !(error instanceof BindingIdentityConflictError)) throw error
          upsertMediaDecision(source.id, songId, 'defer', initialization.id)
          db.prepare("UPDATE source_initialization_items SET tier='conflict', decision_status='conflict', updated_at=? WHERE initialization_id=? AND netease_song_id=?").run(new Date().toISOString(), initialization.id, songId)
          conflicts++
        }
      }
      summary = `首次媒体接管完成：接管 ${applied}，计划下载 ${downloads}，暂缓 ${deferred}，冲突 ${conflicts}`
      setInitializationStatus(initialization.id, 'completed', { summary })
      if (initialization.runId) {
        const previous = getRun(initialization.runId)
        const existing = taskRun({ id: initialization.runId, trigger: initialization.trigger as TaskRunTrigger, sourceId: source.id, sourceName: source.name, status: conflicts ? 'partial' : 'success', summary, total: rows.length, success: applied + downloads, skipped: deferred, failed: conflicts })
        if (previous) {
          existing.startedAt = previous.startedAt
          existing.durationMs = Math.max(0, Date.parse(existing.finishedAt || new Date().toISOString()) - Date.parse(previous.startedAt))
        }
        saveRun(existing)
      }
      const followUpRequestId = (currentSource.enabled || allowDisabled) ? persistSourceRequest({ sourceId: source.id, kind: 'convergence', trigger: 'user', followUpOf: initialization.id, allowDisabled }) : null
      result = { applied, deferred, downloads, conflicts, shouldSync: currentSource.enabled || allowDisabled, sourceId: source.id, followUpRequestId }
      db.prepare('UPDATE source_initializations SET commit_result_json=? WHERE id=?').run(JSON.stringify(result), initialization.id)
      // Keep the executed review and score evidence for audit and later correction.
    })()
  } finally { release() }
  return result
}

export async function commitSourceInitialization(initializationId: string, allowQueued = false): Promise<InitializationCommitResult> {
  const quick = getDb().prepare("SELECT status FROM initialization_quick_operations WHERE initialization_id=? AND status='queued'").get(initializationId)
  if (quick && !allowQueued) throw new InitializationConflictError('快速方案已排队，不能重复提交')
  if (getInitialization(initializationId)?.status === 'applying') throw new InitializationConflictError('首次媒体接管方案正在应用，请稍后刷新')
  try {
    return await applySourceInitialization(initializationId, allowQueued || Boolean(getInitialization(initializationId)?.quickStatus))
  } catch (error) {
    const current = getInitialization(initializationId)
    if (current?.status === 'applying') {
      setInitializationStatus(initializationId, 'awaiting_review', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  }
}

export function skipSourceInitialization(sourceId: string): void {
  const latest = getLatestInitialization(sourceId)
  if (latest && ['analyzing', 'applying'].includes(latest.status)) {
    throw new Error('首次媒体接管正在处理，不能跳过')
  }
  const initialization = ensurePendingInitialization(sourceId, 'user')
  const summary = '用户已明确跳过首次媒体接管'
  getDb().transaction(() => {
    const now = new Date().toISOString()
    getDb().prepare("UPDATE source_sync_queue SET status='cancelled', finished_at=?, updated_at=? WHERE initialization_id=? AND status='pending'").run(now, now, initialization.id)
    setInitializationStatus(initialization.id, 'skipped', { summary })
    if (!initialization.runId) return
    const previous = getRun(initialization.runId)
    if (!previous) return
    const finishedAt = new Date().toISOString()
    saveRun({
      ...previous,
      status: 'cancelled',
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(previous.startedAt)),
      summary,
    })
  })()
}
