import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloneConfig } from '../config/validation'
import { DEFAULT_CONFIG } from '../config/defaults'
import { closeDb, getDb, initDb } from '../db'
import { getSource, updateSource } from '../playlist/store'
import { assertSourcesReadyForConvergence, groupSourcesByInitializationGate, resolveInitializationGate } from './gate'
import {
  effectiveInitializationEnabled,
  ensurePendingInitialization,
  getActiveMediaDecisions,
  getInitialization,
  queryInitializationItems,
  replaceInitializationPlans,
  resolveMediaDecision,
  setInitializationCandidate,
  setInitializationDecisions,
  setInitializationStatus,
  upsertMediaDecision,
} from './store'

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-initialization-store-'))
  initDb(directory)
  const now = new Date().toISOString()
  getDb().prepare(`INSERT INTO playlist_sources (
    id, netease_playlist_id, name, enabled, netease_playlist_name, created_at, updated_at
  ) VALUES ('source-1', 1, 'Source', 1, 'Source', ?, ?)`)
    .run(now, now)
})

afterEach(() => {
  closeDb()
  rmSync(directory, { recursive: true, force: true })
})

describe('source initialization persistence and gate', () => {
  it('inherits the global setting and supports a per-source override', () => {
    const config = cloneConfig(DEFAULT_CONFIG)
    config.sync.initializeMediaOnFirstSync = true
    expect(effectiveInitializationEnabled(getSource('source-1')!, config)).toBe(true)
    updateSource('source-1', { initializeMediaOnFirstSync: false })
    expect(effectiveInitializationEnabled(getSource('source-1')!, config)).toBe(false)
  })

  it('blocks ordinary sync until review is completed', () => {
    const config = cloneConfig(DEFAULT_CONFIG)
    const pending = ensurePendingInitialization('source-1', 'user')
    expect(resolveInitializationGate(getSource('source-1')!, config)).toEqual({ action: 'analyze' })
    setInitializationStatus(pending.id, 'awaiting_review', { runId: 'run-1' })
    expect(resolveInitializationGate(getSource('source-1')!, config)).toMatchObject({ action: 'awaiting_review', runId: 'run-1' })
    setInitializationStatus(pending.id, 'completed')
    expect(resolveInitializationGate(getSource('source-1')!, config)).toEqual({ action: 'sync' })
  })

  it('stores only active defer and download decisions for the source snapshot', () => {
    const initialization = ensurePendingInitialization('source-1')
    upsertMediaDecision('source-1', 1, 'defer', initialization.id)
    upsertMediaDecision('source-1', 2, 'download', initialization.id)
    expect([...getActiveMediaDecisions('source-1')]).toEqual([[1, 'defer'], [2, 'download']])
    expect(getActiveMediaDecisions('unrelated')).toEqual(new Map())
    resolveMediaDecision('source-1', 1)
    expect([...getActiveMediaDecisions('source-1')]).toEqual([[2, 'download']])
    expect(getActiveMediaDecisions('source-1').has(3)).toBe(false)
  })

  it('keeps analyze, awaiting-review, and ready sources separate for multi-source entrypoints', () => {
    const now = new Date().toISOString()
    getDb().prepare(`INSERT INTO playlist_sources (
      id, netease_playlist_id, name, enabled, netease_playlist_name, created_at, updated_at
    ) VALUES ('source-2', 2, 'Source 2', 1, 'Source 2', ?, ?),
             ('source-3', 3, 'Source 3', 1, 'Source 3', ?, ?)`)
      .run(now, now, now, now)
    const waiting = ensurePendingInitialization('source-2', 'user')
    setInitializationStatus(waiting.id, 'awaiting_review', { runId: 'run-2' })
    const config = cloneConfig(DEFAULT_CONFIG)
    updateSource('source-3', { initializeMediaOnFirstSync: false })

    const grouped = groupSourcesByInitializationGate([
      getSource('source-1')!,
      getSource('source-2')!,
      getSource('source-3')!,
    ], config)

    expect(grouped.analyze.map(source => source.id)).toEqual(['source-1'])
    expect(grouped.awaitingReview.map(source => source.id)).toEqual(['source-2'])
    expect(grouped.ready.map(source => source.id)).toEqual(['source-3'])
    expect(() => assertSourcesReadyForConvergence([
      getSource('source-1')!,
      getSource('source-2')!,
      getSource('source-3')!,
    ], config)).toThrow('2 个来源尚未完成首次媒体接管')
  })

  it('rejects draft changes after the initialization leaves review', () => {
    const initialization = ensurePendingInitialization('source-1', 'user')
    replaceInitializationPlans(initialization.id, [{
      neteaseSongId: 42,
      position: 0,
      occurrenceCount: 1,
      title: 'Signal',
      artists: ['Alpha'],
      album: 'Night Drive',
      trackNumber: 1,
      durationMs: 180_000,
      tier: 'high_confidence',
      candidate: { ratingKey: '100', title: 'Signal', artist: 'Alpha', album: 'Night Drive', durationMs: 180_000, trackNumber: 1, filePath: '/music/Signal.flac' },
      candidates: [],
      evidence: {},
      expectedBindingUpdatedAt: null,
      decision: 'defer',
    }])
    setInitializationStatus(initialization.id, 'applying')

    expect(() => setInitializationDecisions({
      initializationId: initialization.id,
      songIds: [42],
      decision: 'adopt',
    })).toThrow('不在等待确认状态')
    expect(queryInitializationItems({ initializationId: initialization.id }).items[0]?.decision).toBe('defer')
  })

  it('keeps preserved bindings out of editable decisions and decision totals', () => {
    const initialization = ensurePendingInitialization('source-1', 'user')
    replaceInitializationPlans(initialization.id, [
      {
        neteaseSongId: 41, position: 0, occurrenceCount: 1, title: 'Bound', artists: ['Alpha'], album: 'Album',
        trackNumber: 1, durationMs: 180_000, tier: 'preserved', candidate: null, candidates: [], evidence: {},
        expectedBindingUpdatedAt: '2026-01-01T00:00:00.000Z', decision: 'defer',
      },
      {
        neteaseSongId: 42, position: 1, occurrenceCount: 1, title: 'Candidate', artists: ['Alpha'], album: 'Album',
        trackNumber: 2, durationMs: 181_000, tier: 'high_confidence',
        candidate: { ratingKey: '100', title: 'Candidate', artist: 'Alpha', album: 'Album', durationMs: 181_000, trackNumber: 2, filePath: '/music/Candidate.flac' },
        candidates: [], evidence: {}, expectedBindingUpdatedAt: null, decision: 'defer',
      },
    ])
    setInitializationStatus(initialization.id, 'awaiting_review')

    expect(getInitialization(initialization.id)).toMatchObject({ preservedItems: 1, adoptItems: 0, downloadItems: 0, deferredItems: 1 })
    expect(setInitializationDecisions({ initializationId: initialization.id, songIds: [41, 42], decision: 'download' })).toBe(1)

    const items = queryInitializationItems({ initializationId: initialization.id }).items
    expect(items.find(item => item.neteaseSongId === 41)).toMatchObject({ kind: 'preserved', decision: null, allowedDecisions: [], canSearch: false })
    expect(items.find(item => item.neteaseSongId === 42)?.decision).toBe('download')
    expect(getInitialization(initialization.id)).toMatchObject({ adoptItems: 0, downloadItems: 1, deferredItems: 0 })
    expect(() => setInitializationCandidate({
      initializationId: initialization.id,
      songId: 41,
      candidate: { ratingKey: '101', filePath: '/music/Other.flac', title: 'Other', artist: 'Alpha', album: 'Album' },
    })).toThrow('已有绑定不可修改')
  })
})
