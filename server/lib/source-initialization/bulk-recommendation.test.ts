import { describe, expect, it } from 'vitest'
import { matchingPreset, type InitializationMatchingConfig } from '../../../shared/initialization-matching'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { buildInitializationPlans } from './candidate-engine'

const song: NeteaseSong = { id: 42, name: 'Signal', no: 1, dt: 180000, disc: '1', artists: [{ name: 'Alpha' }], album: { id: 1, name: 'Single', picUrl: '', publishTime: 0 } }
const track: PlexTrack = { ratingKey: '10', title: 'Signal', grandparentTitle: 'Alpha', parentTitle: 'Single', index: 1, duration: 180000, Media: [{ audioCodec: 'mp3', bitrate: 320, Part: [{ file: '/music/Alpha/Signal.mp3' }] }] }
const lossless: PlexTrack = { ...track, ratingKey: '20', parentTitle: 'Compilation', Media: [{ audioCodec: 'flac', bitrate: 900, audioBitDepth: 24, audioSampleRate: 48000, Part: [{ file: '/music/Alpha/Signal.flac' }] }] }
function run(tracks = [track], patch: Partial<InitializationMatchingConfig> = {}, target: NeteaseSong = song) {
  return buildInitializationPlans({ songs: [target], tracks, bindings: new Map(), matching: { ...matchingPreset('balanced'), ...patch } })[0]!
}

describe('configurable bulk recommendations', () => {
  it('defaults to highest quality among qualified candidates, retaining all alternatives', () => {
    const plan = run([track, lossless])
    expect(plan.candidate?.ratingKey).toBe('20')
    expect(plan.tier).toBe('high_confidence')
    expect(plan.decision).toBe('defer')
    expect(plan.candidates).toHaveLength(2)
    expect(plan.evidence.reasons).toContainEqual(expect.stringContaining('最高质量'))
    expect(run([track, lossless], { duplicatePolicy: 'review', preferExactAlbum: false }).tier).toBe('ambiguous')
  })
  it('ranks real quality metadata and resolves equal-quality ties stably', () => {
    const better = { ...lossless, ratingKey: '30', Media: [{ ...lossless.Media![0], audioSampleRate: 96000 }] }
    expect(run([better, lossless]).candidate?.ratingKey).toBe('30')
    expect(run([lossless, better]).candidate?.ratingKey).toBe('30')
    expect(run([lossless, { ...lossless, ratingKey: '2' }]).candidate?.ratingKey).toBe('2')
    const many = Array.from({ length: 25 }, (_, index) => ({ ...track, ratingKey: `low-${index}` }))
    const result = run([...many, lossless])
    expect(result.candidates).toHaveLength(20)
    expect(result.candidates[0]!.ratingKey).toBe(result.candidate!.ratingKey)
  })
  it('does not rank an ineligible high-quality file above a verified candidate', () => {
    for (const patch of [{ title: 'Signal (Live)' }, { duration: 200000 }, { grandparentTitle: 'Unrelated', originalTitle: 'Unrelated' }]) {
      expect(run([track, { ...lossless, ...patch }]).candidate?.ratingKey).toBe('10')
    }
    expect(run([track, { ...lossless, Media: [{ ...lossless.Media![0], Part: [{ file: '/music/Signal [netease-99].flac' }] }] }]).candidate?.ratingKey).toBe('10')
  })
  it('can recommend a strict subset of collaborators only when explicitly enabled', () => {
    const target = { ...song, artists: [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }] }
    expect(run([track], { corroboratedRecommendations: false }, target).tier).not.toBe('high_confidence')
    const result = run([track], { ignoreMissingCollaborators: true }, target)
    expect(result.tier).toBe('high_confidence')
    expect(result.evidence.reasons).toContainEqual(expect.stringContaining('忽略缺失合作歌手'))
    expect(result.decision).toBe('defer')
    for (const artist of ['Beta', 'Alpha & Stranger']) expect(run([{ ...track, originalTitle: artist }], { ignoreMissingCollaborators: true }, target).tier).not.toBe('high_confidence')
    expect(run([{ ...track, title: 'Signal (Live)' }], { ignoreMissingCollaborators: true }, target).tier).not.toBe('high_confidence')
    expect(run([{ ...track, duration: 190000 }], { ignoreMissingCollaborators: true }, target).tier).not.toBe('high_confidence')
    expect(run([track], { ignoreMissingCollaborators: true }, { ...target, artists: [] }).tier).not.toBe('high_confidence')
  })
})
