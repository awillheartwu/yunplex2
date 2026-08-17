import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../db'
import { configureMusicBrainz, resolveMusicBrainzIdToRecording, resolveRecording } from './musicbrainz'

let dataDir = ''

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function replaceRecordingCacheWithLegacyConstraint(): void {
  getDb().exec(`
    DROP TABLE musicbrainz_recording_cache;
    CREATE TABLE musicbrainz_recording_cache (
      lookup_key TEXT PRIMARY KEY,
      resolved_json TEXT NOT NULL,
      last_status TEXT NOT NULL CHECK(last_status IN ('success','empty','failed','disabled')),
      score INTEGER,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      updated_at TEXT NOT NULL
    );
  `)
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'reyunplex-musicbrainz-'))
  initDb(dataDir)
  configureMusicBrainz({ minScore: 90, minRunnerUpGap: 5, requestTimeoutMs: 500, requestIntervalMs: 0 })
})

afterEach(() => {
  closeDb()
  rmSync(dataDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MusicBrainz recording resolution', () => {
  it('coalesces concurrent resolution requests for the same identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [{
        id: 'recording-shared',
        title: 'Shared Song',
        score: 100,
        'artist-credit': [{ artist: { name: 'Shared Artist' } }],
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([
      resolveRecording('Shared Song', ['Shared Artist']),
      resolveRecording('Shared Song', ['Shared Artist']),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first?.id).toBe('recording-shared')
    expect(second?.id).toBe('recording-shared')
  })

  it('retries an empty featured-title query with the collaboration descriptor removed', async () => {
    const recordingId = '9771041b-ffe9-4f99-a6d9-70884f30fd73'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ recordings: [] }))
      .mockResolvedValueOnce(jsonResponse({ recordings: [] }))
      .mockResolvedValueOnce(jsonResponse({ recordings: [{
        id: recordingId,
        title: 'Vanish',
        score: 100,
        'artist-credit': [
          { artist: { name: 'Breathe Carolina' } },
          { artist: { name: 'Crossnaders' } },
          { artist: { name: 'KARRA' } },
        ],
      }] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording(
      'Vanish (feat. KARRA)',
      ['Breathe Carolina', 'Crossnaders', 'Karra'],
      'Sleepless',
    )
    const cached = await resolveRecording(
      'Vanish (feat. KARRA)',
      ['Karra', 'Crossnaders', 'Breathe Carolina'],
      'Sleepless',
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const queries = fetchMock.mock.calls.map(call => new URL(String(call[0])).searchParams.get('query') ?? '')
    expect(queries[0]).toContain('recording:"Vanish (feat. KARRA)"')
    expect(queries[1]).toContain('recording:"Vanish (feat. KARRA)"')
    expect(queries[2]).toContain('recording:"Vanish"')
    expect(queries[2]).toContain('release:"Sleepless"')
    expect(result).toMatchObject({
      id: recordingId,
      status: 'success',
      queryTitle: 'Vanish',
      attemptedTitles: ['Vanish (feat. KARRA)', 'Vanish'],
    })
    expect(cached).toMatchObject({
      id: recordingId,
      cacheHit: true,
      queryTitle: 'Vanish',
      attemptedTitles: ['Vanish (feat. KARRA)', 'Vanish'],
    })
  })

  it('maps a Plex release-track MBID to its recording and persists the typed result', async () => {
    const releaseTrackId = '8220c472-146e-4a9e-a71e-fd8beb603e14'
    const recordingId = '1cdb1f16-31e5-4765-af6e-c3c02386dcc4'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Not Found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ recordings: [{ id: recordingId, title: 'Easy Come Easy Go', score: 100 }] }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await resolveMusicBrainzIdToRecording(releaseTrackId)
    const second = await resolveMusicBrainzIdToRecording(releaseTrackId)

    expect(first).toMatchObject({
      inputId: releaseTrackId,
      recordingId,
      entityType: 'release_track',
      status: 'success',
      candidateRecordingIds: [recordingId],
      cacheHit: false,
    })
    expect(second).toMatchObject({ recordingId, entityType: 'release_track', status: 'success', cacheHit: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]![0])).toContain(encodeURIComponent(`tid:${releaseTrackId}`))
  })

  it('recognizes an actual recording MBID without running the release-track search', async () => {
    const recordingId = '48a7d7c0-4da7-40ce-bb9d-50026bec4d53'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: recordingId, title: '渡口' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveMusicBrainzIdToRecording(recordingId)

    expect(result).toMatchObject({
      inputId: recordingId,
      recordingId,
      entityType: 'recording',
      status: 'success',
      cacheHit: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps multiple release-track mappings ambiguous and never exposes an automatic ID', async () => {
    const inputId = 'c675819c-c6cc-3dae-bf00-d3788e2690f1'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ recordings: [
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '渡口', score: 100 },
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '渡口 (Live)', score: 100 },
      ] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveMusicBrainzIdToRecording(inputId)

    expect(result).toMatchObject({
      inputId,
      recordingId: null,
      entityType: 'release_track',
      status: 'ambiguous',
      candidateRecordingIds: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ],
    })
  })

  it('falls back from an empty release query to title and artist and records the query path', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ recordings: [] }))
      .mockResolvedValueOnce(jsonResponse({
        recordings: [{
          id: 'recording-1',
          title: '艾蜜莉',
          score: 100,
          'artist-credit': [{ artist: { name: '回春丹' } }],
        }],
      }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('艾蜜莉', '回春丹', '耳鬼出风')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const strictQuery = decodeURIComponent(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('query') ?? '')
    const fallbackQuery = decodeURIComponent(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get('query') ?? '')
    expect(strictQuery).toContain('release:"耳鬼出风"')
    expect(fallbackQuery).not.toContain('release:')
    expect(result).toMatchObject({
      id: 'recording-1',
      status: 'success',
      queryStrategy: 'title_artist',
      attemptedStrategies: ['title_artist_release', 'title_artist'],
      cacheHit: false,
    })
  })

  it('queries multiple artist aliases without treating one spelling as canonical', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [{
        id: 'recording-alias',
        title: '温室',
        score: 100,
        'artist-credit': [{ artist: { name: '灯诱LampLure' } }],
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('温室', ['Various Artists', '灯诱LampLure', 'LampLure'])
    const reorderedAliasResult = await resolveRecording('温室', ['LampLure', '灯诱LampLure'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const query = new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('query') ?? ''
    expect(query).toContain('artist:"灯诱LampLure" OR artist:"LampLure"')
    expect(query).not.toContain('Various Artists')
    expect(result).toMatchObject({ id: 'recording-alias', status: 'success', queryStrategy: 'title_artist' })
    expect(reorderedAliasResult).toMatchObject({ id: 'recording-alias', status: 'success', cacheHit: true })
  })

  it('does not use Plex placeholder artist or album values as hard query constraints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ recordings: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('你要跳舞吗', 'Various Artists', '[Unknown Album]')
    const sameQueryWithoutPlaceholders = await resolveRecording('你要跳舞吗', [], '')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const query = new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('query') ?? ''
    expect(query).toBe('recording:"你要跳舞吗"')
    expect(result).toMatchObject({ id: null, status: 'empty', queryStrategy: 'title_only' })
    expect(sameQueryWithoutPlaceholders).toMatchObject({ status: 'empty', cacheHit: true })
  })

  it('keeps a unique title-only result review-only because it lacks identity constraints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [{
        id: 'title-only-recording',
        title: '你要跳舞吗',
        score: 100,
        'artist-credit': [{ artist: { name: '新裤子' } }],
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('你要跳舞吗', 'Various Artists', '[Unknown Album]')

    expect(result).toMatchObject({
      id: null,
      score: 100,
      status: 'ambiguous',
      ambiguityReason: 'insufficient_constraints',
      queryStrategy: 'title_only',
      candidates: [{ id: 'title-only-recording', score: 100 }],
    })
  })

  it('persists close runner-up candidates as ambiguous and never exposes an automatic binding ID', async () => {
    replaceRecordingCacheWithLegacyConstraint()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [
        { id: 'recording-a', title: '无地自容', score: 100, 'artist-credit': [{ artist: { name: '黑豹乐队' } }] },
        { id: 'recording-b', title: '无地自容', score: 98, 'artist-credit': [{ artist: { name: '黑屋乐队' } }] },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await resolveRecording('无地自容', ['黑豹乐队', '黑屋乐队'])
    const second = await resolveRecording('无地自容', ['黑屋乐队', '黑豹乐队'])

    expect(first).toMatchObject({
      id: null,
      score: 100,
      status: 'ambiguous',
      runnerUpGap: 2,
      ambiguityReason: 'runner_up_too_close',
      candidates: [
        { id: 'recording-a', score: 100 },
        { id: 'recording-b', score: 98 },
      ],
      cacheHit: false,
    })
    expect(second).toMatchObject({ id: null, status: 'ambiguous', cacheHit: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const cached = getDb().prepare(`
      SELECT resolved_json, last_status
      FROM musicbrainz_recording_cache
    `).get() as { resolved_json: string; last_status: string }
    expect(JSON.parse(cached.resolved_json)).toMatchObject({ status: 'ambiguous', runnerUpGap: 2 })
    // Existing v34 tables reject a literal ambiguous last_status; the JSON is
    // authoritative until the schema migration can widen the CHECK constraint.
    expect(cached.last_status).toBe('empty')
  })

  it('uses a uniquely closest duration to resolve tied recordings after excluding incompatible versions', async () => {
    const regularRounded = '2f080c1d-3cb6-4697-9c4c-cdcf225f9a0f'
    const regularExact = '4c34a9be-b6c3-4c79-8a5d-dcad96ba2ee9'
    const instrumental = '4f30288e-9e53-4dca-8cc5-8b3e69505958'
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [
        {
          id: regularRounded,
          title: '11',
          score: 100,
          length: 234000,
          'artist-credit': [{ artist: { name: '队长' } }, { artist: { name: '黄礼格' } }],
        },
        {
          id: regularExact,
          title: '11',
          score: 100,
          length: 234817,
          'artist-credit': [{ artist: { name: '队长' } }, { artist: { name: '黄礼格' } }],
        },
        {
          id: instrumental,
          title: '11(Instrumental)',
          score: 98,
          length: 234817,
          'artist-credit': [{ artist: { name: '队长' } }, { artist: { name: '黄礼格' } }],
        },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('11', ['队长', '黄礼格'], '11', {
      durationMs: 234817,
      durationToleranceMs: 2000,
      minDurationSeparationMs: 500,
    })
    const cached = await resolveRecording('11', ['黄礼格', '队长'], '11', {
      durationMs: 234817,
      durationToleranceMs: 2000,
      minDurationSeparationMs: 500,
    })

    expect(result).toMatchObject({
      id: regularExact,
      score: 100,
      status: 'success',
      ambiguityReason: null,
      durationEvidence: {
        targetMs: 234817,
        toleranceMs: 2000,
        minSeparationMs: 500,
        selectedCandidateId: regularExact,
        closestDeltaMs: 0,
        runnerUpDeltaMs: 817,
        separationMs: 817,
        outcome: 'selected',
      },
      candidates: [
        { id: regularRounded, lengthMs: 234000, durationDeltaMs: 817, titleDescriptorCompatible: true },
        { id: regularExact, lengthMs: 234817, durationDeltaMs: 0, titleDescriptorCompatible: true },
        { id: instrumental, lengthMs: 234817, durationDeltaMs: 0, titleDescriptorCompatible: false },
      ],
    })
    expect(cached).toMatchObject({ id: regularExact, status: 'success', cacheHit: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps close duration evidence ambiguous when the nearest candidate is not clearly separated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [
        { id: 'near-a', title: '同名歌', score: 100, length: 234700 },
        { id: 'near-b', title: '同名歌', score: 100, length: 234817 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('同名歌', '同名艺人', '', {
      durationMs: 234817,
      durationToleranceMs: 2000,
      minDurationSeparationMs: 500,
    })

    expect(result).toMatchObject({
      id: null,
      status: 'ambiguous',
      ambiguityReason: 'runner_up_too_close',
      durationEvidence: {
        selectedCandidateId: null,
        closestDeltaMs: 0,
        runnerUpDeltaMs: 117,
        separationMs: 117,
        outcome: 'runner_up_too_close',
      },
    })
  })

  it('does not use duration when any score-competitive recording has no published length', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [
        { id: 'known-length', title: '同名歌', score: 100, length: 234817 },
        { id: 'unknown-length', title: '同名歌', score: 100 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('同名歌', '同名艺人', '', { durationMs: 234817 })

    expect(result).toMatchObject({
      id: null,
      status: 'ambiguous',
      ambiguityReason: 'runner_up_too_close',
      durationEvidence: {
        selectedCandidateId: null,
        outcome: 'missing_candidate_durations',
      },
    })
  })

  it('isolates duration-dependent cache decisions for different versions of the same metadata', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({
      recordings: [
        { id: 'short-version', title: '同名歌', score: 100, length: 200000 },
        { id: 'long-version', title: '同名歌', score: 100, length: 240000 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const short = await resolveRecording('同名歌', '同名艺人', '同名专辑', { durationMs: 200000 })
    const long = await resolveRecording('同名歌', '同名艺人', '同名专辑', { durationMs: 240000 })
    const cachedShort = await resolveRecording('同名歌', '同名艺人', '同名专辑', { durationMs: 200000 })

    expect(short).toMatchObject({ id: 'short-version', status: 'success', cacheHit: false })
    expect(long).toMatchObject({ id: 'long-version', status: 'success', cacheHit: false })
    expect(cachedShort).toMatchObject({ id: 'short-version', status: 'success', cacheHit: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM musicbrainz_recording_cache').get())
      .toEqual({ count: 2 })
  })

  it('never promotes a duration-identical candidate with an incompatible recording descriptor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [
        { id: 'instrumental-only', title: '同名歌 (Instrumental)', score: 100, length: 234817 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('同名歌', '同名艺人', '', { durationMs: 234817 })

    expect(result).toMatchObject({
      id: null,
      status: 'ambiguous',
      ambiguityReason: 'identity_descriptor_mismatch',
      candidates: [{ id: 'instrumental-only', titleDescriptorCompatible: false }],
    })
  })

  it('caches network failures separately from empty results and never exposes an ID', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('socket closed'))
    vi.stubGlobal('fetch', fetchMock)

    const first = await resolveRecording('人生浪费指南', ['夏日入侵企画', 'Summer Warz'], '人生浪费指南')
    const second = await resolveRecording('人生浪费指南', ['Summer Warz', '夏日入侵企画'], '人生浪费指南')

    expect(first).toMatchObject({
      id: null,
      status: 'failed',
      failureReason: 'network_error',
      queryStrategy: 'title_artist_release',
      attemptedStrategies: ['title_artist_release'],
      cacheHit: false,
    })
    expect(second).toMatchObject({ id: null, status: 'failed', cacheHit: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getDb().prepare('SELECT last_status FROM musicbrainz_recording_cache').get())
      .toEqual({ last_status: 'failed' })
  })

  it('keeps a below-threshold strict-release candidate for review without broadening the query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [{
        id: 'weak-recording',
        title: '温室',
        score: 86,
        'artist-credit': [{ artist: { name: '灯诱LampLure' } }],
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('温室', ['灯诱LampLure', 'LampLure'], '灯诱LampLure')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      id: null,
      status: 'ambiguous',
      ambiguityReason: 'below_threshold',
      queryStrategy: 'title_artist_release',
      attemptedStrategies: ['title_artist_release'],
      candidates: [{ id: 'weak-recording', score: 86 }],
    })
  })

  it('hydrates legacy cache rows and re-evaluates their ID when the score policy changes', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('cache miss'))
    vi.stubGlobal('fetch', fetchMock)
    const lookupKey = ['旧歌', '旧艺人', '旧专辑'].join('\u001f')
    getDb().prepare(`
      INSERT INTO musicbrainz_recording_cache
        (lookup_key, resolved_json, last_status, score, failure_count, last_attempt_at, updated_at)
      VALUES (?, ?, 'success', 95, 0, ?, ?)
    `).run(
      lookupKey,
      JSON.stringify({
        id: 'legacy-recording',
        score: 95,
        title: '旧歌',
        artist: '旧艺人',
        cacheHit: false,
      }),
      new Date().toISOString(),
      new Date().toISOString(),
    )

    const acceptedUnderOldPolicy = await resolveRecording('旧歌', '旧艺人', '旧专辑')
    configureMusicBrainz({ minScore: 96 })
    const rejectedUnderNewPolicy = await resolveRecording('旧歌', '旧艺人', '旧专辑')

    expect(acceptedUnderOldPolicy).toMatchObject({ id: 'legacy-recording', status: 'success', cacheHit: true })
    expect(rejectedUnderNewPolicy).toMatchObject({
      id: null,
      status: 'ambiguous',
      ambiguityReason: 'below_threshold',
      cacheHit: true,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never auto-selects tied recording IDs even when the configured minimum gap is zero', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [
        { id: 'tie-a', title: '同名歌', score: 100 },
        { id: 'tie-b', title: '同名歌', score: 100 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)
    configureMusicBrainz({ minRunnerUpGap: 0 })

    const result = await resolveRecording('同名歌', '同名艺人')

    expect(result).toMatchObject({
      id: null,
      status: 'ambiguous',
      runnerUpGap: 0,
      ambiguityReason: 'runner_up_too_close',
    })
  })

  it('selects a high-confidence leader when the distinct runner-up is safely separated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      recordings: [
        { id: 'leader', title: '唯一录音', score: 100 },
        { id: 'distant-runner-up', title: '唯一录音', score: 91 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resolveRecording('唯一录音', '目标艺人')

    expect(result).toMatchObject({
      id: 'leader',
      status: 'success',
      runnerUpGap: 9,
      ambiguityReason: null,
      candidates: [
        { id: 'leader', score: 100 },
        { id: 'distant-runner-up', score: 91 },
      ],
    })
  })
})
