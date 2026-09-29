import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb, writeConfigToDb } from '../db'
import { DEFAULT_CONFIG } from '../config/defaults'
import { captureMatchingPolicy, matchingFingerprint } from './matching-snapshot'
import { analyzeSourceInitialization } from './service'
import { getInitialization } from './store'
import { matchingPreset } from '../../../shared/initialization-matching'
import { upsertSongIdentityBinding } from '../sync/identity-store'
import { resolveMusicBrainzAliases } from './musicbrainz-aliases'

const { fetchPlaylistSongs, initPlexClient, getSectionKey, getSectionTracks } = vi.hoisted(() => ({
  fetchPlaylistSongs: vi.fn(),
  initPlexClient: vi.fn(),
  getSectionKey: vi.fn(),
  getSectionTracks: vi.fn(),
}))

vi.mock('../netease', () => ({ fetchPlaylistSongs }))
vi.mock('../plex-client', () => ({ initPlexClient, getSectionKey, getSectionTracks }))
vi.mock('./musicbrainz-aliases', async importOriginal => ({
  ...await importOriginal<typeof import('./musicbrainz-aliases')>(),
  resolveMusicBrainzAliases: vi.fn(),
}))

let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'reyunplex-matching-snapshot-'))
  initDb(dataDir)
  getDb().prepare(`
    INSERT INTO playlist_sources (id, netease_playlist_id, name, netease_playlist_name, type, created_at, updated_at)
    VALUES ('snapshot-source', 1, 'Snapshot source', 'Snapshot source', 'playlist', 'now', 'now')
  `).run()
  getDb().prepare(`
    INSERT INTO source_initializations (id, source_id, status, created_at, updated_at)
    VALUES ('snapshot-initialization', 'snapshot-source', 'pending', 'now', 'now')
  `).run()

  fetchPlaylistSongs.mockResolvedValue({
    songs: [{
      id: 42,
      name: 'Snapshot song',
      no: 1,
      dt: 180000,
      disc: '1',
      artists: [{ name: 'Snapshot artist' }],
      album: { id: 7, name: 'Snapshot album', picUrl: '', publishTime: 0 },
    }],
    trackIds: [{ id: 42 }],
    allTrackIds: [{ id: 42 }],
    trackUpdateTime: null,
    playlistName: 'Snapshot source',
    playlist: null,
  })
  initPlexClient.mockResolvedValue(undefined)
  getSectionKey.mockResolvedValue('music')
  getSectionTracks.mockResolvedValue([{
    ratingKey: 'plex-42',
    title: 'Snapshot song',
    grandparentTitle: 'Snapshot artist',
    parentTitle: 'Snapshot album',
    index: 1,
    duration: 180000,
    Media: [{ Part: [{ file: '/music/Snapshot song.flac' }] }],
  }])
})

afterEach(() => {
  closeDb()
  rmSync(dataDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('initialization matching snapshots', () => {
  it('persists provider evidence and warnings with the draft without creating identities or downloads', async () => {
    const evidence = { groups: [{ name: 'Snapshot artist', aliases: ['Another Name'], enabled: true, mbid: 'f760b097-e57c-4037-86f6-24a474c1b4dc', score: 100 }], queried: 1, skipped: 1, warnings: ['Provider partially unavailable'] }
    vi.mocked(resolveMusicBrainzAliases).mockResolvedValueOnce(evidence)
    writeConfigToDb({ ...structuredClone(DEFAULT_CONFIG), initializationMatching: { ...matchingPreset('balanced'), musicBrainzAliases: true } })
    await analyzeSourceInitialization('snapshot-source', 'user')
    expect(getInitialization('snapshot-initialization')!.matchingConfig?.musicBrainz).toEqual(evidence)
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM song_identity_bindings').get()).toEqual({ n: 0 })
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM download_tasks').get()).toEqual({ n: 0 })
    evidence.groups[0]!.aliases.push('Later change')
    expect(getInitialization('snapshot-initialization')!.matchingConfig?.musicBrainz?.groups[0]!.aliases).toEqual(['Another Name'])
  })
  it('freezes the analyzed policy and candidates when app config changes', async () => {
    const analyzedPolicy = matchingPreset('balanced')
    writeConfigToDb({ ...structuredClone(DEFAULT_CONFIG), initializationMatching: analyzedPolicy })

    await analyzeSourceInitialization('snapshot-source', 'user')

    const before = getInitialization('snapshot-initialization')!
    const beforeItem = getDb().prepare(`
      SELECT tier, candidate_rating_key, candidate_file_path, candidates_json, evidence_json
      FROM source_initialization_items WHERE initialization_id = 'snapshot-initialization'
    `).get()
    const beforeCounts = {
      identities: getDb().prepare('SELECT COUNT(*) AS count FROM song_identity_bindings').get(),
      downloads: getDb().prepare('SELECT COUNT(*) AS count FROM download_tasks').get(),
      decisions: getDb().prepare('SELECT COUNT(*) AS count FROM source_media_decisions').get(),
    }

    const changedPolicy = { ...matchingPreset('discovery'), preferredDirectory: '/changed-after-analysis' }
    writeConfigToDb({ ...structuredClone(DEFAULT_CONFIG), initializationMatching: changedPolicy })

    const after = getInitialization('snapshot-initialization')!
    const afterItem = getDb().prepare(`
      SELECT tier, candidate_rating_key, candidate_file_path, candidates_json, evidence_json
      FROM source_initialization_items WHERE initialization_id = 'snapshot-initialization'
    `).get()

    expect(after.ruleVersion).toBe(8)
    expect(after.rulesCompatible).toBe(true)
    expect(after.matchingConfig).toEqual(captureMatchingPolicy({
      ...structuredClone(DEFAULT_CONFIG),
      initializationMatching: analyzedPolicy,
    }))
    expect(after.matchingConfigFingerprint).toBe(matchingFingerprint(before.matchingConfig))
    expect(after.matchingDataFingerprint).toEqual(before.matchingDataFingerprint)
    expect(afterItem).toEqual(beforeItem)
    expect({
      identities: getDb().prepare('SELECT COUNT(*) AS count FROM song_identity_bindings').get(),
      downloads: getDb().prepare('SELECT COUNT(*) AS count FROM download_tasks').get(),
      decisions: getDb().prepare('SELECT COUNT(*) AS count FROM source_media_decisions').get(),
    }).toEqual(beforeCounts)
    expect(before.matchingConfig?.config.preferredDirectory).toBe('')
    expect(after.matchingConfig?.config.preferredDirectory).toBe('')
    expect(fetchPlaylistSongs).toHaveBeenCalledWith(1, 10, '', { preserveArtistNames: true })
  })

  it('keeps disabled legacy aliases in the captured policy and does not mutate config', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.other.artistAliases = { '旧艺人': '新艺人' }
    config.initializationMatching = { ...matchingPreset('balanced'), enabled: false }

    const captured = captureMatchingPolicy(config)

    expect(captured.legacyAliases).toEqual({ '旧艺人': '新艺人' })
    expect(config.other.artistAliases).toEqual({ '旧艺人': '新艺人' })
    expect(config.initializationMatching?.enabled).toBe(false)
  })

  it('treats an active binding owned by another song as a candidate conflict', async () => {
    upsertSongIdentityBinding({
      neteaseSongId: 999,
      plexSectionKey: 'music',
      plexFilePath: '/music/Snapshot song.flac',
      plexRatingKey: 'plex-42',
      bindingMethod: 'manual',
      status: 'active',
      evidence: { source: 'outside-snapshot-source' },
    })
    writeConfigToDb({ ...structuredClone(DEFAULT_CONFIG), initializationMatching: matchingPreset('balanced') })

    await analyzeSourceInitialization('snapshot-source', 'user')

    const item = getDb().prepare(`
      SELECT tier, candidate_rating_key, evidence_json
      FROM source_initialization_items WHERE initialization_id = 'snapshot-initialization'
    `).get() as { tier: string; candidate_rating_key: string | null; evidence_json: string }
    const evidence = JSON.parse(item.evidence_json) as { conflicts?: string[] }

    expect(item.tier).toBe('conflict')
    expect(item.candidate_rating_key).toBeNull()
    expect(evidence.conflicts).toContain('此媒体已关联其他网易云歌曲，或文件标识属于另一首歌曲')
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM song_identity_bindings').get()).toEqual({ count: 1 })
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM download_tasks').get()).toEqual({ count: 0 })
  })
})
