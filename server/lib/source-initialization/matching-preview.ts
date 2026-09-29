import { randomUUID } from 'node:crypto'
import type { InitializationMatchingConfig, MatchingCounts, MatchingPreviewItem, MatchingPreviewResult, MusicBrainzMatchingEvidence } from '../../../shared/initialization-matching'
import { readConfigFromDb } from '../db'
import { fetchPlaylistSongs, type NeteaseSong } from '../netease'
import { getSectionKey, getSectionTracks, initPlexClient, type PlexTrack } from '../plex-client'
import { getSource } from '../playlist/store'
import { getInitializationIdentityBindings, type SongIdentityBinding } from '../sync/identity-store'
import { buildInitializationPlans } from './candidate-engine'
import { captureMatchingPolicy, matchingFingerprint, type MatchingPolicySnapshot } from './matching-snapshot'
import type { InitializationItemPlan } from './types'
import { matchingKey } from './matching-normalization'
import { getInitialization, getLatestInitialization } from './store'
import { resolveMusicBrainzAliases } from './musicbrainz-aliases'

const TTL = 20 * 60_000
const snapshots = new Map<string, PreviewSnapshot>()
let loading = false
export interface PreviewSnapshot {
  id: string; sourceId: string; sourceName: string; capturedAt: string; expiresAt: string
  songs: NeteaseSong[]; trackIds: Array<{ id: number }>; tracks: PlexTrack[]
  bindings: Map<number, SongIdentityBinding>; baseline: MatchingPolicySnapshot
  musicBrainz?: MusicBrainzMatchingEvidence
  musicBrainzPolicyKey?: string
  initializationId?: string
}

export async function previewMatching(input: { sourceId: string; config: InitializationMatchingConfig; snapshotId?: string; initializationId?: string }): Promise<MatchingPreviewResult> {
  for (const [id, snapshot] of snapshots) if (Date.parse(snapshot.expiresAt) <= Date.now()) snapshots.delete(id)
  const previous = input.initializationId ? getInitialization(input.initializationId) : null
  if (input.initializationId && (!previous || previous.sourceId !== input.sourceId || getLatestInitialization(input.sourceId)?.id !== previous.id)) throw new Error('接管草案已变化，请刷新后重新试算')
  let snapshot: PreviewSnapshot
  if (input.snapshotId) {
    const found = snapshots.get(input.snapshotId)
    if (!found || found.sourceId !== input.sourceId) throw new Error('试算快照已过期或不属于当前歌单，请重新读取数据')
    if (found.initializationId !== input.initializationId) throw new Error('试算快照的接管草案不一致，请重新读取数据')
    snapshot = found
  } else {
    if (loading) throw new Error('正在读取试算数据，请稍后重试')
    loading = true
    try {
      const source = getSource(input.sourceId)
      if (!source || source.type !== 'playlist') throw new Error('请选择有效的歌单来源')
      const config = readConfigFromDb()
      const playlist = await fetchPlaylistSongs(source.neteasePlaylistId, source.syncLimit ?? config.sync.songLimit, config.netease.cookie, { preserveArtistNames: true })
      await initPlexClient(config.plex)
      const section = await getSectionKey(config.plex.section)
      if (!section) throw new Error('未找到 Plex 音乐库分区')
      const tracks = await getSectionTracks(section)
      snapshot = { id: randomUUID(), initializationId: input.initializationId, sourceId: source.id, sourceName: source.name,
        capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TTL).toISOString(),
        songs: playlist.songs, trackIds: playlist.trackIds, tracks,
        bindings: getInitializationIdentityBindings(playlist.songs.map(song => song.id)), baseline: previous?.matchingConfig ?? captureMatchingPolicy(config) }
      while (snapshots.size >= 3) snapshots.delete(snapshots.keys().next().value!)
      snapshots.set(snapshot.id, snapshot)
    } finally { loading = false }
  }
  const baseline = snapshot.baseline
  if (baseline.config.enabled && baseline.config.musicBrainzAliases && baseline.config.useArtistAliases && !baseline.musicBrainz) {
    const plans = buildInitializationPlans({ songs: snapshot.songs, tracks: snapshot.tracks, bindings: snapshot.bindings, matching: baseline.config })
    baseline.musicBrainz = await resolveMusicBrainzAliases(plans, baseline.config)
  }
  if (input.config.enabled && input.config.musicBrainzAliases && input.config.useArtistAliases) {
    const key = matchingFingerprint(input.config)
    if (snapshot.musicBrainzPolicyKey !== key) {
      if (baseline.musicBrainz && key === matchingFingerprint(baseline.config)) snapshot.musicBrainz = baseline.musicBrainz
      else {
        const plans = buildInitializationPlans({ songs: snapshot.songs, tracks: snapshot.tracks, bindings: snapshot.bindings, matching: input.config })
        snapshot.musicBrainz = await resolveMusicBrainzAliases(plans, input.config)
      }
      snapshot.musicBrainzPolicyKey = key
    }
  }
  return compareMatchingSnapshot(snapshot, input.config)
}

export function compareMatchingSnapshot(snapshot: PreviewSnapshot, config: InitializationMatchingConfig): MatchingPreviewResult {
  const run = (policy: InitializationMatchingConfig, aliases: Record<string, string>, musicBrainz?: MusicBrainzMatchingEvidence) => buildInitializationPlans({ songs: snapshot.songs, tracks: snapshot.tracks, bindings: snapshot.bindings, matching: policy, aliases, musicBrainz })
  const before = run(snapshot.baseline.config, snapshot.baseline.legacyAliases, snapshot.baseline.musicBrainz)
  const after = run(config, snapshot.baseline.legacyAliases, snapshot.musicBrainz)
  const previous = new Map(before.map(plan => [plan.neteaseSongId, plan]))
  const items = after.map(plan => previewItem(previous.get(plan.neteaseSongId)!, plan))
  const known = new Set(snapshot.songs.map(song => song.id))
  const missing = [...new Set(snapshot.trackIds.map(track => track.id))].filter(id => !known.has(id))
  for (const songId of missing) items.push({ songId, title: `网易云 ${songId}`, artists: [], before: 'metadata_missing', after: 'metadata_missing', change: 'unchanged', candidate: null, candidates: [], reasons: ['网易云元数据缺失'], conflicts: [] })
  return { snapshotId: snapshot.id, sourceId: snapshot.sourceId, sourceName: snapshot.sourceName, capturedAt: snapshot.capturedAt, expiresAt: snapshot.expiresAt,
    total: items.length, trackCount: snapshot.tracks.length, configFingerprint: matchingFingerprint(config), before: counts(before, missing.length), after: counts(after, missing.length), items,
    aliasSuggestions: suggestAliases(snapshot, config),
    musicBrainz: config.enabled && config.musicBrainzAliases && config.useArtistAliases ? snapshot.musicBrainz : undefined }
}

function classification(plan: InitializationItemPlan): string { return String(plan.evidence.classification || plan.tier) }
function counts(plans: InitializationItemPlan[], missing: number): MatchingCounts {
  const result: MatchingCounts = { preserved: 0, strong: 0, recommended: 0, review: 0, duplicates: 0, versionConflicts: 0, identityConflicts: 0, unmatched: 0, metadataMissing: missing }
  const keys: Record<string, keyof MatchingCounts> = { preserved: 'preserved', strong_id: 'strong', high_confidence: 'recommended', unmatched: 'unmatched', duplicates: 'duplicates', version_conflict: 'versionConflicts', conflict: 'identityConflicts' }
  for (const plan of plans) result[keys[classification(plan)] ?? 'review']++
  return result
}
function previewItem(before: InitializationItemPlan, after: InitializationItemPlan): MatchingPreviewItem {
  const from = classification(before), to = classification(after)
  const rank: Record<string, number> = { high_confidence: 3, strong_id: 4, preserved: 5, possible: 2, ambiguous: 1, duplicates: 1, version_conflict: 0, unmatched: 0 }
  const change = from !== to ? (rank[to] ?? 0) > (rank[from] ?? 0) ? 'added' : (rank[to] ?? 0) < (rank[from] ?? 0) ? 'downgraded' : 'changed'
    : before.candidate?.ratingKey !== after.candidate?.ratingKey
      || JSON.stringify(before.candidates.map(candidate => [candidate.ratingKey, candidate.filePath])) !== JSON.stringify(after.candidates.map(candidate => [candidate.ratingKey, candidate.filePath])) ? 'candidate_changed' : 'unchanged'
  return { songId: after.neteaseSongId, title: after.title, artists: after.artists, before: from, after: to, change,
    candidate: after.candidate, candidates: after.candidates,
    reasons: Array.isArray(after.evidence.reasons) ? after.evidence.reasons as string[] : [legacyReason(String(after.evidence.rule))],
    conflicts: Array.isArray(after.evidence.conflicts) ? after.evidence.conflicts as string[] : [], }
}
function legacyReason(rule: string): string {
  return ({ active_binding_verified: '现有关联的媒体与路径仍然有效', unique_netease_path_id: '唯一网易云文件标识，且标题与时长一致', duplicate_netease_path_id: '网易云文件标识对应多个媒体', strict_local_metadata: '标题、完整艺人、专辑、曲序与时长严格一致', title_artist_duration: '标题、主要艺人与时长一致，其他证据需确认', title_only_candidate: '同名候选的其他证据不足', multiple_local_candidates: '存在多个候选，需要逐项确认', no_local_candidate: '当前规则没有找到候选' } as Record<string, string>)[rule] || '请结合候选元数据确认'
}
function suggestAliases(snapshot: PreviewSnapshot, config: InitializationMatchingConfig): MatchingPreviewResult['aliasSuggestions'] {
  const groups = new Map<string, MatchingPreviewResult['aliasSuggestions'][number]>()
  const seenSongs = new Map<string, Set<number>>()
  const byTitle = new Map<string, PlexTrack[]>()
  for (const track of snapshot.tracks) { const key = matchingKey(track.title, config); byTitle.set(key, [...(byTitle.get(key) ?? []), track]) }
  for (const song of snapshot.songs) {
    if (song.artists.length !== 1 || !song.artists[0]?.name) continue
    const name = song.artists[0].name
    for (const track of byTitle.get(matchingKey(song.name, config)) ?? []) {
      const alias = track.originalTitle || track.grandparentTitle
      if (!alias || matchingKey(name, config) === matchingKey(alias, config) || /various artists/i.test(alias)) continue
      if (!song.dt || !track.duration || Math.abs(song.dt - track.duration) > 1000 || !song.album.name || matchingKey(song.album.name, config) !== matchingKey(track.parentTitle || '', config)) continue
      const paths = track.Media?.flatMap(media => media.Part?.map(part => part.file ?? '') ?? []) ?? []
      if (!paths.some(path => path.split('/').slice(0, -1).some(part => matchingKey(part, config) === matchingKey(name, config)))) continue
      const key = `${name}\0${alias}`
      const group = groups.get(key) ?? { name, aliases: [alias], enabled: true, count: 0, examples: [] }
      if (!seenSongs.has(key)) seenSongs.set(key, new Set())
      if (!seenSongs.get(key)!.has(song.id)) { group.count++; if (group.examples.length < 5) group.examples.push(song.name); seenSongs.get(key)!.add(song.id) }
      groups.set(key, group)
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 100)
}
