import { setTimeout as delay } from 'node:timers/promises'
import type { InitializationMatchingConfig, MusicBrainzMatchingEvidence } from '../../../shared/initialization-matching'
import type { InitializationItemPlan } from './types'
import { artistMatchingKey as matchingKey } from '../../../shared/initialization-matching-text'

interface Artist { id: string; name: string; score: number; type?: string; aliases?: Array<{ name: string; type?: string }> }
interface SearchResult { count: number; artists: Artist[] }
const cache = new Map<string, { expires: number; data: SearchResult }>()
let tail: Promise<unknown> = Promise.resolve()
let nextRequestAt = 0
const USER_AGENT = 'reYunPlex/0.1.0 (https://github.com/awillheartwu/yunplex2)'
const GENERIC_ARTISTS = new Set(['variousartists', 'various', 'unknownartist', 'unknown', 'anonymous', '群星', '佚名', '未知艺术家', '未知艺人'])

async function searchArtist(name: string, signal?: AbortSignal): Promise<SearchResult> {
  const key = name.normalize('NFC').toLowerCase().trim()
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.data
  const work = tail.catch(() => {}).then(async () => {
    signal?.throwIfAborted()
    const repeated = cache.get(key)
    if (repeated && repeated.expires > Date.now()) return repeated.data
    await delay(Math.max(0, nextRequestAt - Date.now()), undefined, { signal })
    nextRequestAt = Date.now() + 1100
    const literals = [name, ...embeddedArtistNames(name).slice(0, 1)].map(value => value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&'))
    const url = new URL('https://musicbrainz.org/ws/2/artist/')
    url.search = new URLSearchParams({ query: literals.map(literal => `(artist:"${literal}" OR alias:"${literal}")`).join(' OR '), fmt: 'json', limit: '100' }).toString()
    const request = () => {
      const timeout = AbortSignal.timeout(8000)
      return fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    }
    let response = await request()
    if ([429, 503].includes(response.status)) {
      const retryAfter = response.headers.get('retry-after')
      const waitSeconds = retryAfter && Number.isFinite(Number(retryAfter)) ? Math.max(5, Number(retryAfter)) : 5
      if (waitSeconds <= 30) {
        await delay(waitSeconds * 1000, undefined, { signal })
        nextRequestAt = Date.now() + 1100
        response = await request()
      }
    }
    if (!response.ok) throw new Error(`MusicBrainz HTTP ${response.status}`)
    const data = await response.json() as SearchResult
    if (!Array.isArray(data.artists) || !Number.isFinite(data.count)) throw new Error('MusicBrainz response invalid')
    while (cache.size >= 512) cache.delete(cache.keys().next().value!)
    cache.set(key, { expires: Date.now() + 24 * 60 * 60_000, data })
    return data
  })
  tail = work
  return work
}

/** Exact-name uniqueness is required independently of the relevance score. */
export function uniqueMusicBrainzArtist(name: string, data: SearchResult, config: InitializationMatchingConfig): Artist | null {
  if (data.count > data.artists.length) return null // Cannot establish uniqueness from a truncated search.
  const key = matchingKey(name, config)
  if (!key || GENERIC_ARTISTS.has(key)) return null
  const embedded = embeddedArtistNames(name).map(value => matchingKey(value, config))
  const exact = data.artists.filter(artist => {
    const names = new Set(artistNames(artist).map(value => matchingKey(value, config)))
    return names.has(key) || (embedded.length === 2 && embedded.every(part => names.has(part)))
  })
  if (exact.length !== 1 || !validScore(exact[0]!.score, config)) return null
  const artist = exact[0]!
  if (artist.id === '89ad4ac3-39f7-470e-963a-56509c546377' || GENERIC_ARTISTS.has(matchingKey(artist.name, config))) return null
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(artist.id) ? artist : null
}

function validScore(score: unknown, config: InitializationMatchingConfig): boolean {
  const value = typeof score === 'number' || (typeof score === 'string' && score.trim()) ? Number(score) : NaN
  return Number.isFinite(value) && value >= config.musicBrainzMinScore && value <= 100
}

/** Parenthetical names are only evidence if both appear on the same MB artist. */
function embeddedArtistNames(name: string): string[] {
  const match = name.match(/^([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]+)[(（]([\p{Script=Latin}\p{M}\s.'-]+)[)）]$/u)
  return match ? [match[1]!.trim(), match[2]!.trim()] : []
}

function artistNames(artist: Artist): string[] {
  return [...new Set([artist.name, ...(artist.aliases ?? []).filter(alias => alias.type !== 'Search hint').map(alias => alias.name)])]
    .filter(name => typeof name === 'string' && /[\p{L}\p{N}]/u.test(name) && name.length <= 256)
    .filter(name => name === artist.name || !/\b(?:feat(?:uring)?|ft|with)\.?\s|[×:：]/iu.test(name))
    .filter(name => name === artist.name || artist.type === 'Group' || !/[&/+、;；]|\band\b/iu.test(name))
}

/** Fetch only high-frequency unresolved artist names. No names are written to the manual dictionary. */
export async function resolveMusicBrainzAliases(plans: InitializationItemPlan[], config: InitializationMatchingConfig, signal?: AbortSignal,
  search: (name: string, signal?: AbortSignal) => Promise<SearchResult> = searchArtist): Promise<MusicBrainzMatchingEvidence> {
  const result: MusicBrainzMatchingEvidence = { groups: [], queried: 0, skipped: 0, warnings: [] }
  if (!config.enabled || !config.musicBrainzAliases || !config.useArtistAliases) return result
  const frequency = new Map<string, number>()
  for (const plan of plans) {
    if (['preserved', 'strong_id', 'high_confidence', 'metadata_missing', 'conflict'].includes(plan.tier)) continue
    if ((plan.evidence?.reasons as string[] | undefined)?.includes('完整艺人集合一致（含已确认别名）')) continue
    const reasons = plan.evidence?.reasons as string[] | undefined
    const delta = plan.evidence?.durationDeltaMs
    const weight = plan.candidates?.length && reasons?.includes('标题归一化或已确认别名一致') && typeof delta === 'number' && delta <= config.recommendDurationMs ? 4 : 1
    for (const name of new Set(plan.artists.filter(name => name.trim() && !GENERIC_ARTISTS.has(matchingKey(name, config))))) frequency.set(name, (frequency.get(name) ?? 0) + weight)
  }
  const names = [...frequency].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name)
  const selected = names.slice(0, config.musicBrainzMaxArtists)
  result.skipped = names.length - selected.length
  const ids = new Set<string>()
  for (const name of selected) {
    signal?.throwIfAborted()
    try {
      const data = await search(name, signal); result.queried++
      const artist = uniqueMusicBrainzArtist(name, data, config)
      if (!artist || ids.has(artist.id)) continue
      const aliases = artistNames(artist).filter(alias => matchingKey(alias, config) !== matchingKey(name, config))
      if (!aliases.length) continue
      ids.add(artist.id)
      result.groups.push({ name, aliases, enabled: true, mbid: artist.id, score: Number(artist.score) })
    } catch (error) {
      signal?.throwIfAborted()
      result.skipped += selected.length - result.queried
      const reason = error instanceof Error && /^MusicBrainz HTTP \d+$/.test(error.message) ? error.message : '网络超时或响应异常'
      result.warnings.push(`MusicBrainz 查询 ${name} 失败（${reason}）：已停止本轮外部查询，未解析的艺人沿用普通规则。刷新快照可重试。`)
      break
    }
  }
  if (names.length > selected.length) result.warnings.push(`本轮最多查询 ${config.musicBrainzMaxArtists} 位艺人，其余艺人保留普通规则。`)
  return result
}

/** Manual alias decisions win; conflicting provider groups are not unioned transitively. */
export function withMusicBrainzAliases(config: InitializationMatchingConfig, evidence?: MusicBrainzMatchingEvidence): InitializationMatchingConfig {
  if (!config.enabled || !config.musicBrainzAliases || !config.useArtistAliases || !evidence) return config
  const groups = config.artistAliases.map(group => ({ ...group, aliases: [...group.aliases] }))
  let changed = false
  const providerOwners = new Map<string, Set<string>>()
  for (const group of evidence.groups) for (const name of [group.name, ...group.aliases]) {
    const key = matchingKey(name, config)
    if (!providerOwners.has(key)) providerOwners.set(key, new Set())
    providerOwners.get(key)!.add(group.mbid)
  }
  for (const group of evidence.groups) {
    if (!group.enabled || !validScore(group.score, config)) continue
    if (group.mbid === '89ad4ac3-39f7-470e-963a-56509c546377' || GENERIC_ARTISTS.has(matchingKey(group.name, config))) continue
    const keys = new Set([group.name, ...group.aliases].map(name => matchingKey(name, config)))
    if ([...keys].some(key => !key || (providerOwners.get(key)?.size ?? 0) > 1)) continue
    const overlaps = groups.filter(existing => [existing.name, ...existing.aliases].some(name => keys.has(matchingKey(name, config))))
    if (overlaps.length > 1 || overlaps.some(existing => !existing.enabled)) continue
    if (overlaps.length === 1) {
      const existing = overlaps[0]!
      const known = new Set([existing.name, ...existing.aliases].map(name => matchingKey(name, config)))
      for (const name of [group.name, ...group.aliases]) {
        const key = matchingKey(name, config)
        if (known.has(key)) continue
        existing.aliases.push(name); known.add(key); changed = true
      }
    } else {
      groups.push({ name: group.name, aliases: [...group.aliases], enabled: true })
      changed = true
    }
  }
  return changed ? { ...config, artistAliases: groups } : config
}
