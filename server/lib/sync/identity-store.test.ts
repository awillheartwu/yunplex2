import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import {
  buildMatchReviewCandidateKey,
  createMatchReview,
  decideMatchReview,
  decideMatchReviewsBatch,
  getMatchReview,
  getReplacedSongIdentityIdsByRatingKeys,
  getSongIdentityBinding,
  getSongIdentityBindingByRatingKey,
  markAutomaticSongIdentityBindingsStale,
  markSongIdentityBindingStale,
  listMatchReviews,
  normalizePlexRelativePath,
  resolvePlexIdentityPath,
  queryMatchReviews,
  unbindSongIdentity,
  upsertSongIdentityBinding,
  upsertVerifiedSongIdentityBinding,
} from './identity-store'
import { configureResolver } from './artist-resolver'

const dirs: string[] = []
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-identity-'))
  dirs.push(dir)
  initDb(dir)
}
afterEach(() => { closeDb(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('song identity store', () => {
  it('rebuild invalidates automatic identities while preserving manual authority', () => {
    setup()
    upsertSongIdentityBinding({ neteaseSongId: 1, plexSectionKey: '12', plexFilePath: '/music/auto.flac', plexRatingKey: '1', mbRecordingId: null, bindingMethod: 'path', status: 'active', evidence: {} })
    upsertSongIdentityBinding({ neteaseSongId: 2, plexSectionKey: '12', plexFilePath: '/music/manual.flac', plexRatingKey: '2', mbRecordingId: null, bindingMethod: 'manual', status: 'active', evidence: {} })

    expect(markAutomaticSongIdentityBindingsStale([1, 2], { sourceId: 'source-1' })).toBe(1)
    expect(getSongIdentityBinding(1)?.status).toBe('stale')
    expect(getSongIdentityBinding(2)?.status).toBe('active')
  })

  it('refreshes verification without changing the durable identity version', () => {
    setup()
    const original = upsertVerifiedSongIdentityBinding({
      neteaseSongId: 99,
      plexSectionKey: '12',
      plexFilePath: '/volume1/Music/Artist/Album/01.flac',
      plexRatingKey: 'old-rating',
      mbRecordingId: 'recording-99',
      bindingMethod: 'mb_recording',
      status: 'active',
      evidence: { validation: 'initial' },
      lastVerifiedAt: '2026-07-23T00:00:00.000Z',
    })

    const verified = upsertVerifiedSongIdentityBinding({
      neteaseSongId: 99,
      plexSectionKey: '12',
      plexFilePath: '/volume1/Music/Artist/Album/01.flac',
      plexRatingKey: 'new-rating',
      mbRecordingId: 'recording-99',
      bindingMethod: 'mb_recording',
      status: 'active',
      evidence: { validation: 'path_recovered' },
      lastVerifiedAt: '2026-07-24T00:00:00.000Z',
    })

    expect(verified).toMatchObject({
      plexRatingKey: 'new-rating',
      updatedAt: original.updatedAt,
      lastVerifiedAt: '2026-07-24T00:00:00.000Z',
      evidence: { validation: 'path_recovered' },
    })
  })

  it('recovers a unique replaced ratingKey from durable identity events', () => {
    setup()
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 98,
      plexSectionKey: '12',
      plexFilePath: '/volume1/Music/old.flac',
      plexRatingKey: 'old-rating',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 98,
      plexSectionKey: '12',
      plexFilePath: '/volume1/Music/new.flac',
      plexRatingKey: 'new-rating',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })

    expect(getReplacedSongIdentityIdsByRatingKeys(['old-rating', 'unknown']))
      .toEqual(new Map([['old-rating', 98]]))
  })

  it('recovers a stale automatic binding replaced by an exact managed path', () => {
    setup()
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 95,
      plexSectionKey: '12',
      plexFilePath: '/volume1/Music/external-old.flac',
      plexRatingKey: 'stale-old-rating',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })
    markSongIdentityBindingStale(95, { reason: 'manual_rebuild_matching' })
    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 95,
      plexSectionKey: '12',
      plexFilePath: '/volume1/Music/managed-new.flac',
      plexRatingKey: 'managed-new-rating',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {
        source: 'plex_retry_exact_path',
        matchedBy: 'path_lookup',
        mediaPolicy: 'download_missing',
      },
    })

    expect(getReplacedSongIdentityIdsByRatingKeys(['stale-old-rating']))
      .toEqual(new Map([['stale-old-rating', 95]]))
  })

  it('does not recover a replaced ratingKey shared by multiple song histories', () => {
    setup()
    for (const neteaseSongId of [96, 97]) {
      upsertVerifiedSongIdentityBinding({
        neteaseSongId,
        plexSectionKey: '12',
        plexFilePath: `/volume1/Music/${neteaseSongId}-old.flac`,
        plexRatingKey: 'shared-old-rating',
        mbRecordingId: null,
        bindingMethod: 'path',
        status: 'active',
        evidence: {},
      })
      upsertVerifiedSongIdentityBinding({
        neteaseSongId,
        plexSectionKey: '12',
        plexFilePath: `/volume1/Music/${neteaseSongId}-new.flac`,
        plexRatingKey: `new-rating-${neteaseSongId}`,
        mbRecordingId: null,
        bindingMethod: 'path',
        status: 'active',
        evidence: {},
      })
    }

    expect(getReplacedSongIdentityIdsByRatingKeys(['shared-old-rating'])).toEqual(new Map())
  })

  it('keeps a global path binding and lets an accepted review replace it', () => {
    setup()
    upsertSongIdentityBinding({ neteaseSongId: 100, plexSectionKey: '12', plexFilePath: '/volume1/Music/A.flac', plexRatingKey: '1', mbRecordingId: null, bindingMethod: 'path', status: 'active', evidence: { proof: 'path' } })
    const review = createMatchReview({ neteaseSongId: 100, candidatePlexFilePath: '/volume1/Music/B.flac', candidatePlexRatingKey: '2' })
    decideMatchReview(review.id, 'accept', { plexSectionKey: '12', plexFilePath: '/volume1/Music/B.flac', plexRatingKey: '2', evidence: { reviewer: 'test' } })
    expect(getSongIdentityBinding(100)).toMatchObject({ plexFilePath: '/volume1/Music/B.flac', plexRatingKey: '2', bindingMethod: 'manual' })
    expect(listMatchReviews({ status: 'accepted' })).toHaveLength(1)
  })

  it('records manual unbind without deleting the audit history', () => {
    setup()
    upsertSongIdentityBinding({ neteaseSongId: 101, plexSectionKey: '12', plexFilePath: '/volume1/Music/C.flac', plexRatingKey: '3', mbRecordingId: null, bindingMethod: 'path', status: 'active', evidence: {} })
    unbindSongIdentity(101)
    expect(getSongIdentityBinding(101)?.status).toBe('unbound')
    expect(listMatchReviews({ status: 'unbound' })).toHaveLength(1)
  })

  it('does not create the same pending or rejected candidate repeatedly', () => {
    setup()
    const first = createMatchReview({ neteaseSongId: 102, candidatePlexFilePath: '/volume1/Music/D.flac' })
    const second = createMatchReview({ neteaseSongId: 102, candidatePlexFilePath: '/volume1/Music/D.flac' })
    expect(second.id).toBe(first.id)
    decideMatchReview(first.id, 'reject')
    expect(createMatchReview({ neteaseSongId: 102, candidatePlexFilePath: '/volume1/Music/D.flac' }).id).toBe(first.id)
  })

  it('uses the canonical file identity and remembers rejection across sources and ratingKey refreshes', () => {
    setup()
    const decomposed = '/volume1/Music/LampLure/人生逃避號/02 - 温室.flac'.normalize('NFD')
    const first = createMatchReview({
      neteaseSongId: 103,
      sourceId: 'source-a',
      runId: 'run-a',
      candidatePlexFilePath: decomposed,
      candidatePlexRatingKey: '500',
      candidateMbRecordingId: 'ABC-DEF',
    })
    decideMatchReview(first.id, 'reject')

    const repeated = createMatchReview({
      neteaseSongId: 103,
      sourceId: 'source-b',
      runId: 'run-b',
      candidatePlexFilePath: decomposed.normalize('NFC'),
      candidatePlexRatingKey: '500',
      candidateMbRecordingId: 'abc-def',
    })
    const differentRatingKey = createMatchReview({
      neteaseSongId: 103,
      candidatePlexFilePath: decomposed,
      candidatePlexRatingKey: '501',
      candidateMbRecordingId: 'abc-def',
    })
    const differentPath = createMatchReview({
      neteaseSongId: 103,
      candidatePlexFilePath: '/volume1/Music/LampLure/人生逃避號/03 - 温室.flac',
      candidatePlexRatingKey: '501',
      candidateMbRecordingId: 'abc-def',
    })

    expect(repeated).toMatchObject({ id: first.id, status: 'rejected' })
    expect(differentRatingKey.id).toBe(first.id)
    expect(differentPath.id).not.toBe(first.id)
    expect(queryMatchReviews({ sourceId: 'source-b', status: 'rejected' }).items.map(item => item.id)).toEqual([first.id])
  })

  it('returns database totals and status aggregates independently from the current page', () => {
    setup()
    for (let index = 0; index < 130; index += 1) {
      createMatchReview({
        neteaseSongId: 1_000 + index,
        sourceId: index % 2 === 0 ? 'even-source' : 'odd-source',
        candidatePlexFilePath: `/music/pending-${index}.flac`,
        candidatePlexRatingKey: String(index),
        evidenceType: index % 3 === 0 ? 'mb_recording' : 'metadata',
      })
    }
    for (let index = 0; index < 5; index += 1) {
      createMatchReview({
        neteaseSongId: 2_000 + index,
        candidatePlexFilePath: `/music/accepted-${index}.flac`,
        status: 'accepted',
        decision: 'legacy_accept',
      })
    }
    upsertSongIdentityBinding({
      neteaseSongId: 2_000,
      plexSectionKey: '12',
      plexFilePath: '/music/accepted-0.flac',
      plexRatingKey: 'accepted-0',
      mbRecordingId: null,
      bindingMethod: 'manual',
      status: 'active',
      evidence: {},
    })

    const result = queryMatchReviews({ status: 'pending', page: 3, pageSize: 25 })
    expect(result).toMatchObject({ page: 3, pageSize: 25, total: 130, totalPages: 6 })
    expect(result.items).toHaveLength(25)
    expect(result.counts).toMatchObject({ pending: 130, accepted: 5, activeBindings: 1 })

    const filtered = queryMatchReviews({ status: 'pending', sourceId: 'even-source', evidenceType: 'mb_recording' })
    expect(filtered.total).toBe(22)
    expect(filtered.counts.pending).toBe(22)
  })

  it('stores a canonical section-relative identity while retaining the observed Plex path', () => {
    setup()
    const configRow = getDb().prepare("SELECT value FROM config WHERE key = 'app'").get() as { value: string }
    const config = JSON.parse(configRow.value)
    config.download.plexLibraryPathPrefix = '/volume1/06_Music'
    getDb().prepare("UPDATE config SET value = ? WHERE key = 'app'").run(JSON.stringify(config))

    const binding = upsertSongIdentityBinding({
      neteaseSongId: 104,
      plexSectionKey: '12',
      plexFilePath: '/volume1/06_Music/回春丹/耳鬼出风/09 - 艾蜜莉.flac',
      plexRatingKey: '900',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })

    expect(binding.plexFilePath).toBe('/volume1/06_Music/回春丹/耳鬼出风/09 - 艾蜜莉.flac')
    expect(binding.plexRelativePath).toBe('回春丹/耳鬼出风/09 - 艾蜜莉.flac')
    expect(normalizePlexRelativePath('/volume1/06_Music/A/../B.flac', '/volume1/06_Music')).toBe('B.flac')
    expect(resolvePlexIdentityPath({
      relativePath: binding.plexRelativePath,
      currentSectionRoot: '/mnt/new-music-root',
      lastObservedPath: binding.plexFilePath,
    })).toBe('/mnt/new-music-root/回春丹/耳鬼出风/09 - 艾蜜莉.flac')
  })

  it('lets a manual replacement explicitly clear an obsolete MusicBrainz recording id', () => {
    setup()
    upsertSongIdentityBinding({
      neteaseSongId: 105,
      plexSectionKey: '12',
      plexFilePath: '/music/old.flac',
      plexRatingKey: 'old',
      mbRecordingId: 'obsolete-recording',
      bindingMethod: 'mb_recording',
      status: 'active',
      evidence: {},
    })
    const review = createMatchReview({ neteaseSongId: 105, candidatePlexFilePath: '/music/new.flac', candidatePlexRatingKey: 'new' })
    decideMatchReview(review.id, 'accept', {
      plexSectionKey: '12',
      plexFilePath: '/music/new.flac',
      plexRatingKey: 'new',
      mbRecordingId: null,
    })
    expect(getSongIdentityBinding(105)).toMatchObject({ plexRatingKey: 'new', mbRecordingId: null })
  })

  it('does not resurrect a rejected path/rating candidate when MB evidence is enriched later', () => {
    setup()
    const first = createMatchReview({
      neteaseSongId: 106,
      sourceId: 'source-a',
      runId: 'run-a',
      candidatePlexFilePath: '/volume1/Music/Artist/Song.flac',
      candidatePlexRatingKey: '1060',
    })
    decideMatchReview(first.id, 'reject')

    const repeated = createMatchReview({
      neteaseSongId: 106,
      sourceId: 'source-b',
      runId: 'run-b',
      candidatePlexFilePath: '/volume1/Music/Artist/Song.flac',
      candidatePlexRatingKey: '1060',
      candidateMbRecordingId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })

    expect(repeated.id).toBe(first.id)
    expect(repeated.status).toBe('rejected')
    expect(queryMatchReviews({ status: 'pending' }).total).toBe(0)
  })

  it('does not use an ambiguous shared ratingKey as deletion identity', () => {
    setup()
    for (const neteaseSongId of [201, 202]) {
      upsertSongIdentityBinding({
        neteaseSongId,
        plexSectionKey: '12',
        plexFilePath: `/music/${neteaseSongId}.flac`,
        plexRatingKey: 'shared-rating',
        mbRecordingId: null,
        bindingMethod: 'path',
        status: 'active',
        evidence: {},
      })
    }

    expect(getSongIdentityBindingByRatingKey('shared-rating')).toBeNull()
  })

  it('rolls back both the binding and review when accepting a candidate fails midway', () => {
    setup()
    upsertSongIdentityBinding({
      neteaseSongId: 106,
      plexSectionKey: '12',
      plexFilePath: '/music/original.flac',
      plexRatingKey: 'original',
      mbRecordingId: 'original-recording',
      bindingMethod: 'path',
      status: 'active',
      evidence: {},
    })
    const review = createMatchReview({ neteaseSongId: 106, candidatePlexFilePath: '/music/replacement.flac', candidatePlexRatingKey: 'replacement' })
    getDb().exec(`
      CREATE TRIGGER reject_accepted_review BEFORE UPDATE OF status ON song_match_reviews
      WHEN NEW.status = 'accepted' BEGIN SELECT RAISE(ABORT, 'simulated review failure'); END;
    `)

    expect(() => decideMatchReview(review.id, 'accept', {
      plexSectionKey: '12',
      plexFilePath: '/music/replacement.flac',
      plexRatingKey: 'replacement',
      mbRecordingId: null,
    })).toThrow('simulated review failure')
    expect(getSongIdentityBinding(106)).toMatchObject({ plexRatingKey: 'original', mbRecordingId: 'original-recording' })
    expect(getMatchReview(review.id)?.status).toBe('pending')
  })

  it('accepts multiple reviews atomically and creates global bindings', () => {
    setup()
    const first = createMatchReview({ neteaseSongId: 301, candidatePlexFilePath: '/music/301.flac', candidatePlexRatingKey: '301' })
    const second = createMatchReview({ neteaseSongId: 302, candidatePlexFilePath: '/music/302.flac', candidatePlexRatingKey: '302' })

    const result = decideMatchReviewsBatch([
      {
        id: first.id,
        decision: 'accept',
        binding: { plexSectionKey: '12', plexFilePath: '/music/301.flac', plexRatingKey: '301' },
      },
      {
        id: second.id,
        decision: 'accept',
        binding: { plexSectionKey: '12', plexFilePath: '/music/302.flac', plexRatingKey: '302' },
      },
    ])

    expect(result.map(review => review.status)).toEqual(['accepted', 'accepted'])
    expect(getSongIdentityBinding(301)?.plexRatingKey).toBe('301')
    expect(getSongIdentityBinding(302)?.plexRatingKey).toBe('302')
  })

  it('rolls back every batch decision when one selected review conflicts', () => {
    setup()
    const first = createMatchReview({ neteaseSongId: 303, candidatePlexFilePath: '/music/303.flac' })
    const second = createMatchReview({ neteaseSongId: 304, candidatePlexFilePath: '/music/304.flac' })
    decideMatchReview(second.id, 'reject')

    expect(() => decideMatchReviewsBatch([
      { id: first.id, decision: 'reject' },
      { id: second.id, decision: 'accept', binding: { plexSectionKey: '12', plexFilePath: '/music/304.flac' } },
    ])).toThrow('不能再次决策')
    expect(getMatchReview(first.id)?.status).toBe('pending')
    expect(getMatchReview(second.id)?.status).toBe('rejected')
  })

  it('rolls back unbinding when its audit event cannot be persisted', () => {
    setup()
    upsertSongIdentityBinding({
      neteaseSongId: 107,
      plexSectionKey: '12',
      plexFilePath: '/music/bound.flac',
      plexRatingKey: 'bound',
      mbRecordingId: null,
      bindingMethod: 'manual',
      status: 'active',
      evidence: {},
    })
    getDb().exec(`
      CREATE TRIGGER reject_unbind_audit BEFORE INSERT ON song_match_reviews
      WHEN NEW.status = 'unbound' BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;
    `)
    expect(() => unbindSongIdentity(107, 'source', 'run')).toThrow('simulated audit failure')
    expect(getSongIdentityBinding(107)?.status).toBe('active')
  })

  it('builds stable candidate keys from normalized path, rating key, recording and song identity', () => {
    const first = buildMatchReviewCandidateKey({
      neteaseSongId: 108,
      candidatePlexFilePath: '/volume1/music/温室.flac'.normalize('NFD'),
      candidatePlexRatingKey: '1',
      candidateMbRecordingId: 'ABC',
      plexSectionRoot: '/volume1/music',
    })
    const same = buildMatchReviewCandidateKey({
      neteaseSongId: 108,
      candidatePlexFilePath: '/volume1/music/温室.flac'.normalize('NFC'),
      candidatePlexRatingKey: '1',
      candidateMbRecordingId: 'abc',
      plexSectionRoot: '/volume1/music',
    })
    const differentSong = buildMatchReviewCandidateKey({
      neteaseSongId: 109,
      candidatePlexFilePath: '/volume1/music/温室.flac',
      candidatePlexRatingKey: '1',
      candidateMbRecordingId: 'abc',
      plexSectionRoot: '/volume1/music',
    })
    expect(same).toBe(first)
    expect(differentSong).not.toBe(first)

    const enrichedRecording = buildMatchReviewCandidateKey({
      neteaseSongId: 108,
      candidatePlexFilePath: '/volume1/music/温室.flac',
      candidatePlexRatingKey: 'changed-after-plex-refresh',
      candidateMbRecordingId: 'different-but-enriched',
      plexSectionRoot: '/volume1/music',
    })
    expect(enrichedRecording).toBe(first)

    const mbOnlyA = buildMatchReviewCandidateKey({ neteaseSongId: 108, candidateMbRecordingId: 'mb-a' })
    const mbOnlyB = buildMatchReviewCandidateKey({ neteaseSongId: 108, candidateMbRecordingId: 'mb-b' })
    expect(mbOnlyA).not.toBe(mbOnlyB)
  })

  it('upgrades one pending Plex occurrence in place when MB evidence arrives later', () => {
    setup()
    const metadata = createMatchReview({
      neteaseSongId: 110,
      sourceId: 'source-a',
      runId: 'run-a',
      candidatePlexFilePath: '/volume1/music/Artist/Album/Track.flac',
      candidatePlexRatingKey: 'rating-1',
      evidenceType: 'metadata',
      evidence: { reason: 'metadata only' },
    })
    const enriched = createMatchReview({
      neteaseSongId: 110,
      sourceId: 'source-a',
      runId: 'run-b',
      candidatePlexFilePath: '/volume1/music/Artist/Album/Track.flac',
      candidatePlexRatingKey: 'rating-1',
      candidateMbRecordingId: 'recording-1',
      evidenceType: 'mb_recording',
      evidence: { reason: 'recording resolved' },
    })

    expect(enriched.id).toBe(metadata.id)
    expect(enriched.evidenceType).toBe('mb_recording')
    expect(enriched.candidateMbRecordingId).toBe('recording-1')
    expect(enriched.evidence).toEqual({ reason: 'recording resolved' })
    expect(queryMatchReviews({ status: 'pending' }).total).toBe(1)
  })

  it('retires weak pending candidates after a machine-verified binding is established', () => {
    setup()
    createMatchReview({
      neteaseSongId: 111,
      candidatePlexFilePath: '/volume1/music/old.flac',
      candidatePlexRatingKey: 'old-rating',
      evidenceType: 'metadata',
    })

    upsertVerifiedSongIdentityBinding({
      neteaseSongId: 111,
      plexSectionKey: '12',
      plexFilePath: '/volume1/music/exact.flac',
      plexRatingKey: 'exact-rating',
      mbRecordingId: null,
      bindingMethod: 'path',
      status: 'active',
      evidence: { pathExact: true },
    })

    expect(queryMatchReviews({ status: 'pending' }).total).toBe(0)
    expect(queryMatchReviews({ status: 'superseded' }).items[0]).toMatchObject({
      neteaseSongId: 111,
      decision: 'resolved_by_path',
    })
  })

  it('does not clear the artist cache when equivalent alias config is recreated for a new sync', () => {
    setup()
    configureResolver({ enableMB: false, manualAliases: { '夏日入侵企画': 'Summer Warz' } })
    getDb().prepare(`INSERT INTO artist_resolution_cache (normalized_name, original_name, resolved_json, source, confidence, last_status, failure_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('夏日入侵企画', '夏日入侵企画', '{}', 'manual-alias', 100, 'success', 0, new Date().toISOString())
    configureResolver({ enableMB: false, manualAliases: { '夏日入侵企画': 'Summer Warz' } })
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM artist_resolution_cache').get()).toEqual({ count: 1 })
  })
})
