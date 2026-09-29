import { afterEach, describe, expect, it, vi } from 'vitest'
import { matchingPreset, type MusicBrainzMatchingEvidence } from '../../../shared/initialization-matching'
import { resolveMusicBrainzAliases, uniqueMusicBrainzArtist, withMusicBrainzAliases } from './musicbrainz-aliases'
import { buildInitializationPlans } from './candidate-engine'
import type { InitializationItemPlan } from './types'

// node:timers/promises is not replaced by Vitest's global fake timers.
vi.mock('node:timers/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:timers/promises')>()
  return { ...actual, setTimeout: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)) }
})

const config = { ...matchingPreset('balanced'), musicBrainzAliases: true }
const artist = { id: 'f760b097-e57c-4037-86f6-24a474c1b4dc', name: '蔡旻佑', score: 100, aliases: [{ name: 'Evan Yo', type: 'Artist name' }] }
const evidence: MusicBrainzMatchingEvidence = { groups: [{ name: '蔡旻佑', aliases: ['Evan Yo'], enabled: true, mbid: artist.id, score: 100 }], queried: 1, skipped: 0, warnings: [] }
const plan = (name: string) => ({ tier: 'possible', artists: [name] }) as InitializationItemPlan
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('MusicBrainz initialization aliases', () => {
  it('requires unique exact names regardless of score and ignores search hints', () => {
    expect(uniqueMusicBrainzArtist('Evan Yo', { count: 1, artists: [artist] }, config)?.id).toBe(artist.id)
    expect(uniqueMusicBrainzArtist('Evan', { count: 1, artists: [artist] }, config)).toBeNull()
    expect(uniqueMusicBrainzArtist('Evan Yo', { count: 2, artists: [artist, { ...artist, id: 'other' }] }, config)).toBeNull()
    expect(uniqueMusicBrainzArtist('Evan Yo', { count: 101, artists: [artist] }, config)).toBeNull()
    expect(uniqueMusicBrainzArtist('Evan Yo', { count: 1, artists: [{ ...artist, score: 99 }] }, config)).toBeNull()
    expect(uniqueMusicBrainzArtist('Hint', { count: 1, artists: [{ ...artist, aliases: [{ name: 'Hint', type: 'Search hint' }] }] }, config)).toBeNull()
    expect(uniqueMusicBrainzArtist('Evan Yo feat. Other', { count: 1, artists: [{ ...artist, aliases: [{ name: 'Evan Yo feat. Other', type: 'Artist name' }] }] }, config)).toBeNull()
    expect(uniqueMusicBrainzArtist('※', { count: 1, artists: [{ ...artist, aliases: [{ name: '※', type: 'Artist name' }] }] }, config)).toBeNull()
    expect(uniqueMusicBrainzArtist('群星', { count: 1, artists: [{ ...artist, name: 'Various Artists', aliases: [{ name: '群星' }] }] }, config)).toBeNull()
  })
  it('rejects missing, malformed and out-of-range provider scores and malformed IDs', () => {
    for (const score of [undefined, null, NaN, Infinity, 'invalid', 101]) {
      const invalid = { ...artist, score } as unknown as typeof artist
      expect(uniqueMusicBrainzArtist('Evan Yo', { count: 1, artists: [invalid] }, config)).toBeNull()
      const invalidEvidence = { ...evidence, groups: [{ ...evidence.groups[0]!, score }] } as MusicBrainzMatchingEvidence
      expect(withMusicBrainzAliases(config, invalidEvidence)).toBe(config)
    }
    expect(uniqueMusicBrainzArtist('Evan Yo', { count: 1, artists: [{ ...artist, id: '-'.repeat(36) }] }, config)).toBeNull()
  })
  it('reuses unchanged policy when external aliases add no matching evidence', () => {
    expect(withMusicBrainzAliases(config, { ...evidence, groups: [] })).toBe(config)
    const manual = { ...config, artistAliases: [{ name: '蔡旻佑', aliases: ['EVAN YO'], enabled: true }] }
    expect(withMusicBrainzAliases(manual, evidence)).toBe(manual)
    const extended = withMusicBrainzAliases(manual, { ...evidence, groups: [{ ...evidence.groups[0]!, aliases: ['Evan Yo', 'New Alias'] }] })
    expect(extended.artistAliases[0]!.aliases).toEqual(['EVAN YO', 'New Alias'])
    expect(manual.artistAliases[0]!.aliases).toEqual(['EVAN YO'])
  })
  it('does not query when disabled, prioritizes frequent names, and falls back on provider failure', async () => {
    const search = vi.fn().mockResolvedValue({ count: 1, artists: [artist] })
    expect((await resolveMusicBrainzAliases([plan('蔡旻佑')], { ...config, musicBrainzAliases: false }, undefined, search)).queried).toBe(0)
    expect(search).not.toHaveBeenCalled()
    const result = await resolveMusicBrainzAliases([plan('Other'), plan('蔡旻佑'), plan('蔡旻佑')], { ...config, musicBrainzMaxArtists: 1 }, undefined, search)
    expect(search.mock.calls[0]![0]).toBe('蔡旻佑')
    expect(result.groups).toHaveLength(1)
    expect(result.skipped).toBe(1)
    const failed = await resolveMusicBrainzAliases([plan('Other')], config, undefined, async () => { throw new Error('503') })
    expect(failed.warnings).toHaveLength(1)
    expect(failed.groups).toEqual([])
    const abort = new AbortController(); abort.abort()
    await expect(resolveMusicBrainzAliases([plan('Other')], config, abort.signal, search)).rejects.toThrow()
  })
  it('honors manual exclusions and does not merge distinct provider identities', () => {
    expect(withMusicBrainzAliases({ ...config, artistAliases: [{ name: '蔡旻佑', aliases: [], enabled: false }] }, evidence).artistAliases).toHaveLength(1)
    const conflict = { ...evidence, groups: [...evidence.groups, { ...evidence.groups[0]!, name: 'Another Artist', mbid: 'another-id' }] }
    expect(withMusicBrainzAliases(config, conflict).artistAliases).toEqual([])
    expect(withMusicBrainzAliases({ ...config, musicBrainzAliases: false }, evidence).artistAliases).toEqual([])
  })
  it('improves candidates with frozen provider evidence, never media bindings', () => {
    const input = { songs: [{ id: 42, name: 'Song', no: 1, dt: 180000, disc: '1', artists: [{ name: '蔡旻佑' }], album: { id: 1, name: 'Album', picUrl: '', publishTime: 0 } }],
      tracks: [{ ratingKey: '1', title: 'Song', grandparentTitle: 'Evan Yo', parentTitle: 'Album', index: 1, duration: 180000, Media: [{ Part: [{ file: '/music/foreign/Song.flac' }] }] }], bindings: new Map() }
    expect(buildInitializationPlans({ ...input, matching: config })[0]!.tier).toBe('ambiguous')
    const result = buildInitializationPlans({ ...input, matching: config, musicBrainz: evidence })[0]!
    expect(result.tier).toBe('high_confidence')
    expect(result.decision).toBe('defer')
    expect(result.evidence.musicBrainz).toEqual(evidence.groups)
    expect(config.artistAliases).toEqual([])
  })
  it('serializes and caches transport requests and identifies the app to MusicBrainz', async () => {
    vi.useFakeTimers()
    const started: number[] = []
    const fetcher = vi.fn(async (url: URL, options: RequestInit) => {
      started.push(Date.now())
      expect(options.headers).toMatchObject({ 'User-Agent': expect.stringContaining('reYunPlex/') })
      expect(url.origin).toBe('https://musicbrainz.org')
      return new Response(JSON.stringify({ count: 0, artists: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)
    const pending = resolveMusicBrainzAliases([plan('Rate Test Alpha'), plan('Rate Test Beta')], config)
    await vi.runAllTimersAsync()
    await pending
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(1100)
    await resolveMusicBrainzAliases([plan('Rate Test Alpha')], config)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
