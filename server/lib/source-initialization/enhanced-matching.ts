import type { InitializationMatchingConfig } from '../../../shared/initialization-matching'
import type { NeteaseSong } from '../netease'
import type { PlexTrack } from '../plex-client'
import { plexCandidate, type InitializationItemPlan } from './types'
import { aliasKeys, matchingKey, titleParts, versionEvidence, type TitleParts } from './matching-normalization'
import { artistCreditKeys } from './artist-credits'
import { artistMatchingKey } from '../../../shared/initialization-matching-text'
import { compareCandidateQuality } from './candidate-quality'
import { corroboratedArtistEvidence } from './corroborated-recommendation'
import { classicalWorkKey, closeSpelling } from './supplemental-recall'
import { normalizePlexPath, type SongIdentityBinding } from '../sync/identity-store'

type IndexedTrack = { track: PlexTrack; title: TitleParts; paths: string[] }
type Evaluation = { entry: IndexedTrack; reasons: string[]; conflicts: string[]; identityConflict: boolean; versionConflict: boolean; recommend: boolean; strictAlbumMatch: boolean; review: boolean; delta: number | null; album: boolean; number: boolean }

export function enhanceInitializationPlans(plans: InitializationItemPlan[], songs: NeteaseSong[], tracks: PlexTrack[], config: InitializationMatchingConfig, bindings = new Map<number, SongIdentityBinding>()): InitializationItemPlan[] {
  const owners = new Map<string, Set<number>>()
  for (const binding of bindings.values()) if (binding.status === 'active') {
    for (const key of [`key:${binding.plexRatingKey}`, `path:${normalizePlexPath(binding.plexFilePath)}`]) {
      if (!owners.has(key)) owners.set(key, new Set())
      owners.get(key)!.add(binding.neteaseSongId)
    }
  }
  const otherOwner = (entry: IndexedTrack, songId: number): boolean => {
    const keys = [`key:${entry.track.ratingKey}`, ...entry.paths.map(path => `path:${normalizePlexPath(path)}`)]
    return keys.some(key => [...(owners.get(key) ?? [])].some(id => id !== songId))
      || entry.paths.some(path => [...path.matchAll(/\[netease-(\d+)\]/gi)].some(match => Number(match[1]) !== songId))
  }
  const songMap = new Map(songs.map(song => [song.id, song]))
  const indexed: IndexedTrack[] = [...new Map(tracks.map(track => [String(track.ratingKey), track])).values()].map(track => ({
    track, title: titleParts(track.title || '', config), paths: track.Media?.flatMap(media => media.Part?.flatMap(part => part.file ? [part.file] : []) ?? []) ?? [],
  }))
  const byTitle = new Map<string, Set<IndexedTrack>>()
  const byPathTitle = new Map<string, Set<IndexedTrack>>()
  const bySupplemental = new Map<string, Set<IndexedTrack>>()
  const byAlbumTrack = new Map<string, Set<IndexedTrack>>()
  const byWork = new Map<string, Set<IndexedTrack>>()
  const index = (map: Map<string, Set<IndexedTrack>>, key: string, entry: IndexedTrack) => {
    if (!key) return
    if (!map.has(key)) map.set(key, new Set())
    map.get(key)!.add(entry)
  }
  for (const entry of indexed) {
    const keys = new Set(entry.title.variants)
    if (config.titleAliases.length) for (const key of aliasKeys(entry.track.title, config.titleAliases, config)) keys.add(key)
    for (const key of keys) {
      if (!byTitle.has(key)) byTitle.set(key, new Set())
      byTitle.get(key)!.add(entry)
    }
    if (config.supplementalTitleRecall) {
      for (const key of [...entry.title.variants, ...entry.title.supplemental]) index(bySupplemental, key, entry)
      const work = classicalWorkKey(entry.track.title)
      if (work) index(byWork, work, entry)
    }
    const albumKey = matchingKey(entry.track.parentTitle || '', config)
    if (config.metadataFallback && albumKey && Number(entry.track.index) > 0) index(byAlbumTrack, `${albumKey}:${entry.track.index}`, entry)
    if (config.usePathHints) for (const path of entry.paths) {
      const key = matchingKey(path.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/^\d+[. -]+/, ''), config)
      if (!byPathTitle.has(key)) byPathTitle.set(key, new Set())
      byPathTitle.get(key)!.add(entry)
    }
  }
  const result: InitializationItemPlan[] = plans.map(plan => {
    if (plan.tier === 'preserved') return plan
    const song = songMap.get(plan.neteaseSongId)
    if (!song) return plan
    const title = titleParts(song.name, config)
    if (plan.tier === 'strong_id' && plan.candidate) {
      const entry = indexed.find(item => String(item.track.ratingKey) === plan.candidate!.ratingKey)
      const version = entry && versionEvidence(title, entry.title, config)
      if (version && entry && !otherOwner(entry, song.id) && !version.excluded && !version.conflicts.length && !version.review.length) return plan
    }
    const titleKeys = new Set(title.variants)
    for (const key of aliasKeys(song.name, config.titleAliases, config)) titleKeys.add(key)
    const pool = new Set<IndexedTrack>()
    for (const key of titleKeys) for (const entry of byTitle.get(key) ?? []) pool.add(entry)
    if (config.usePathHints) for (const key of titleKeys) for (const entry of byPathTitle.get(key) ?? []) pool.add(entry)
    const recallReasons = new Map<IndexedTrack, string[]>()
    const constrained = (entry: IndexedTrack): boolean => {
      if (!(song.dt > 0 && Number(entry.track.duration) > 0) || Math.abs(song.dt - Number(entry.track.duration)) > config.reviewDurationMs) return false
      const support = artistSupport(song, entry, config, title)
      return support.complete || support.primary || support.pathArtist
    }
    const recall = (entry: IndexedTrack, reason: string) => {
      if (pool.has(entry) || !constrained(entry)) return
      pool.add(entry); recallReasons.set(entry, [reason])
    }
    if (config.supplementalTitleRecall) {
      for (const key of new Set([...titleKeys, ...title.supplemental])) for (const entry of bySupplemental.get(key) ?? []) recall(entry, '扩展标题召回：附注、双语或数字写法不同，需确认')
      const work = classicalWorkKey(song.name)
      if (work) for (const entry of byWork.get(work) ?? []) recall(entry, '作品编号与乐章一致，演奏者或录音版本需确认')
    }
    if (config.fuzzyTitles && title.core.length >= 5) for (const entry of indexed) {
      if (entry.title.core.length >= 5 && constrained(entry) && (title.core.includes(entry.title.core) || entry.title.core.includes(title.core) || closeSpelling(title.core, entry.title.core))) recall(entry, '标题拼写或包含关系召回，需确认')
    }
    if (config.metadataFallback && ![...pool].some(constrained) && song.no > 0 && matchingKey(song.album.name, config)) {
      for (const entry of byAlbumTrack.get(`${matchingKey(song.album.name, config)}:${song.no}`) ?? []) {
        if (song.dt > 0 && Number(entry.track.duration) > 0 && Math.abs(song.dt - Number(entry.track.duration)) <= config.recommendDurationMs) recall(entry, '艺人、专辑、曲序与接近时长补充召回：标题不同，需确认')
      }
    }
    const evaluations = [...pool].map(entry => evaluate(song, title, entry, titleKeys, config, otherOwner(entry, song.id), recallReasons.get(entry) ?? [])).filter((value): value is Evaluation => value !== null)
    evaluations.sort((a, b) => Number(b.recommend) - Number(a.recommend)
      || Number(b.review) - Number(a.review)
      || (config.albumPolicy === 'prefer' ? Number(b.album) - Number(a.album) : 0)
      || (config.trackPolicy === 'prefer' ? Number(b.number) - Number(a.number) : 0)
      || Number(inDirectory(b.entry, config.preferredDirectory)) - Number(inDirectory(a.entry, config.preferredDirectory))
      || (config.preferLossless ? Number(lossless(b.entry)) - Number(lossless(a.entry)) : 0)
      || a.entry.track.ratingKey.localeCompare(b.entry.track.ratingKey))
    const recommended = evaluations.filter(item => item.recommend)
    const reviewable = evaluations.filter(item => item.review)
    let selected = recommended.length === 1 && reviewable.length === 1 ? recommended[0] : reviewable.length === 1 ? reviewable[0] : undefined
    if (!selected && config.duplicatePolicy === 'highest_quality' && recommended.length && reviewable.length > 1) {
      selected = [...recommended].sort((a, b) => compareCandidateQuality(a.entry.track, b.entry.track))[0]
      selected!.reasons.push('按配置优选最高质量候选：仅比较满足推荐条件的媒体，无损、位深、采样率、码率依次优先；同质量按稳定顺序选择，未验证音频等价')
    }
    if (!selected && config.preferExactAlbum && config.albumPolicy === 'prefer' && config.trackPolicy !== 'ignore') {
      const strict = recommended.filter(item => item.strictAlbumMatch)
      if (strict.length === 1 && reviewable.every(item => item === strict[0] || !item.album)) {
        selected = strict[0]
        selected!.reasons.push('目标专辑唯一优选：完整艺人、专辑、曲序与紧密时长唯一吻合，其他可选项均来自不同专辑')
      }
    }
    const duplicates = !selected && reviewable.length > 1
    const versionConflicts = evaluations.length > 0 && evaluations.every(item => item.versionConflict)
    const identityConflicts = evaluations.length > 0 && evaluations.every(item => item.identityConflict)
    const tier = selected ? selected.recommend ? 'high_confidence' : 'possible' : identityConflicts ? 'conflict' : evaluations.length ? 'ambiguous' : 'unmatched'
    const lead = selected ?? evaluations[0]
    const visible = (selected ? [selected, ...evaluations.filter(item => item !== selected)] : evaluations).slice(0, 20)
    // Strong filename identities retain their tier only after the richer version check.
    const strong = plan.tier === 'strong_id' && selected && String(selected.entry.track.ratingKey) === plan.candidate?.ratingKey && !selected.conflicts.length
    return {
      ...plan, tier: strong ? 'strong_id' : tier,
      candidate: selected ? plexCandidate(selected.entry.track) : null,
      candidates: visible.map(item => plexCandidate(item.entry.track)),
      decision: strong ? 'adopt' : 'defer',
      evidence: {
        rule: 'enhanced_metadata', classification: duplicates ? 'duplicates' : versionConflicts ? 'version_conflict' : tier,
        reasons: lead?.reasons ?? [pool.size ? '已找到候选，但被版本或缺失时长规则排除' : '没有满足当前检索规则的候选'], conflicts: lead?.conflicts ?? [],
        durationDeltaMs: lead?.delta ?? null, candidateCount: evaluations.length,
        candidates: visible.map(item => ({ ratingKey: item.entry.track.ratingKey, reasons: item.reasons, conflicts: item.conflicts, recommend: item.recommend, durationDeltaMs: item.delta })),
      },
    }
  })
  const claims = new Map<string, Set<number>>()
  for (const plan of result) if (plan.candidate) {
    for (const key of [`key:${plan.candidate.ratingKey}`, `path:${normalizePlexPath(plan.candidate.filePath || '')}`]) {
      if (!claims.has(key)) claims.set(key, new Set())
      claims.get(key)!.add(plan.neteaseSongId)
    }
  }
  return result.map(plan => {
    if (!plan.candidate || plan.tier === 'preserved') return plan
    const shared = [`key:${plan.candidate.ratingKey}`, `path:${normalizePlexPath(plan.candidate.filePath || '')}`].some(key => (claims.get(key)?.size ?? 0) > 1)
    if (!shared) return plan
    return { ...plan, tier: 'conflict', decision: 'defer', candidate: null,
      evidence: { ...plan.evidence, classification: 'conflict', conflicts: ['同一媒体同时被本歌单的多首网易云歌曲选中，需要逐项确认身份'] } }
  })
}

function evaluate(song: NeteaseSong, title: TitleParts, entry: IndexedTrack, keys: Set<string>, config: InitializationMatchingConfig, identityConflict: boolean, recallReasons: string[]): Evaluation | null {
  const track = entry.track, reasons: string[] = [], conflicts: string[] = []
  const version = versionEvidence(title, entry.title, config)
  if (version.excluded) return null
  conflicts.push(...version.conflicts)
  if (identityConflict) conflicts.push('此媒体已关联其他网易云歌曲，或文件标识属于另一首歌曲')
  reasons.push(...version.review, ...recallReasons)
  const exact = keys.has(entry.title.core) || [...aliasKeys(track.title, config.titleAliases, config)].some(key => keys.has(key))
  reasons.push(exact ? '标题归一化或已确认别名一致' : '扩展标题或文件名召回，需确认')
  const { complete, primary, pathArtist, missingOneContributor, missingCollaborators } = artistSupport(song, entry, config, title)
  reasons.push(complete ? '完整艺人集合一致（含已确认别名）' : primary ? '主要艺人一致，其他参与者需确认' : pathArtist ? '目录艺人一致，Plex 艺人需确认' : '艺人信息不足或不同')
  const delta = song.dt > 0 && Number(track.duration) > 0 ? Math.abs(song.dt - Number(track.duration)) : null
  if (delta === null && config.missingDuration === 'exclude') return null
  const durationOk = delta !== null && delta <= config.recommendDurationMs && delta / song.dt * 100 <= config.recommendDurationPercent
  reasons.push(delta === null ? '时长缺失，需确认' : `时长相差 ${delta} 毫秒`)
  const album = matchingKey(song.album.name, config) === matchingKey(track.parentTitle || '', config) && Boolean(song.album.name)
  const number = song.no > 0 && song.no === Number(track.index)
  if (!album && config.albumPolicy !== 'ignore') reasons.push('专辑不同或缺失')
  if (!number && config.trackPolicy !== 'ignore') reasons.push('曲序不同或缺失')
  const metadataAllowed = (config.albumPolicy !== 'require' || album) && (config.trackPolicy !== 'require' || number)
  const crossEvidence = config.albumPolicy !== 'ignore' && config.trackPolicy !== 'ignore'
    && exact && !recallReasons.length && album && number && durationOk
    && delta !== null && delta <= Math.min(500, config.recommendDurationMs)
    && !conflicts.length && !version.review.length
    ? corroboratedArtistEvidence({ song, track, paths: entry.paths, config, missingOneContributor }) : null
  const bilingual = config.corroboratedBilingualTitles && config.bilingualTitles && !exact && !recallReasons.length
    && entry.title.variants.some(key => keys.has(key)) && complete && album && number && durationOk && delta !== null && delta <= 500
    && config.albumPolicy !== 'ignore' && config.trackPolicy !== 'ignore'
  if (bilingual) reasons.push('双语标题交叉核验：中文标题、完整艺人、专辑、曲序与紧密时长一致')
  const acceptedMissing = config.ignoreMissingCollaborators && missingCollaborators
  const review = !conflicts.length && metadataAllowed && (complete || acceptedMissing || (config.artistPolicy === 'primary' && primary) || pathArtist || Boolean(crossEvidence)) && (delta === null || delta <= config.reviewDurationMs)
  const recommend = review && (complete || acceptedMissing || Boolean(crossEvidence)) && (exact || bilingual) && !recallReasons.length && durationOk && !version.review.length && entry.paths.length === 1
  if (acceptedMissing) reasons.push('按配置忽略缺失合作歌手：主艺人一致，候选参与者均属于目标名单；仍检查标题、时长、版本与媒体身份')
  if (crossEvidence && !complete) reasons.push(crossEvidence)
  if (entry.paths.length !== 1) reasons.push('媒体路径缺失或包含多个文件，需确认')
  return { entry, reasons, conflicts, strictAlbumMatch: recommend && complete && album && number && delta !== null && delta <= 500, identityConflict, versionConflict: version.conflicts.length > 0, recommend, review, delta, album, number }
}
function inDirectory(entry: IndexedTrack, directory: string): boolean { return Boolean(directory && entry.paths.some(path => path.startsWith(directory.replace(/\/+$/, '') + '/'))) }
function lossless(entry: IndexedTrack): boolean { return entry.paths.some(path => /\.(flac|alac|wav|aiff)$/i.test(path)) }
function artistSupport(song: NeteaseSong, entry: IndexedTrack, config: InitializationMatchingConfig, title: TitleParts): { complete: boolean; primary: boolean; pathArtist: boolean; missingOneContributor: boolean; missingCollaborators: boolean } {
  const names = [...new Set(song.artists.map(artist => artist.name).filter(Boolean))]
  const desired = names.map(name => aliasKeys(name, config.useArtistAliases ? config.artistAliases : [], config, true))
  for (const key of artistCreditKeys(title.contributors, desired, config)) {
    if (!desired.some(group => group.has(key))) desired.push(new Set([key]))
  }
  const track = entry.track
  const artistText = config.useTrackArtist && track.originalTitle ? track.originalTitle : track.grandparentTitle || ''
  const actual = artistCreditKeys([artistText, ...entry.title.contributors], desired, config)
  const covered = desired.map(set => actual.some(key => set.has(key)))
  const complete = desired.length > 0 && covered.every(Boolean) && actual.every(key => desired.some(set => set.has(key)))
  const primary = covered[0] === true
  const pathArtist = config.usePathHints && entry.paths.some(path => path.split('/').slice(0, -1).some(part => desired.some(set => set.has(artistMatchingKey(part, config)))))
  const primaryAlbumArtist = desired[0]?.has(artistMatchingKey(track.grandparentTitle || '', config)) ?? false
  const missingOneContributor = desired.length >= 2 && desired.length <= 3 && primary && primaryAlbumArtist
    && actual.length === desired.length - 1 && actual.every(key => desired.some(set => set.has(key)))
  const missingCollaborators = primary && covered.some(value => !value) && actual.length > 0
    && actual.every(key => desired.some(set => set.has(key)))
  return { complete, primary, pathArtist, missingOneContributor, missingCollaborators }
}
