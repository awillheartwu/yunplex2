import { fetchMusicBrainzJson } from './musicbrainz-transport'
import type { MusicBrainzArtistAlias, MusicBrainzResolveResult } from './musicbrainz-types'

const MB_ARTIST_SEARCH_URL = 'https://musicbrainz.org/ws/2/artist/'
let artistMinScore = 90

interface MbSearchArtist {
  name: string
  score: number
  aliases?: Array<{
    name: string
    locale?: string | null
    primary?: boolean
  }>
  disambiguation?: string
}

export function configureMusicBrainzArtist(options: { minScore?: number }): void {
  if (options.minScore !== undefined) artistMinScore = options.minScore
}

/**
 * Artist alias policy. HTTP concerns deliberately stay behind the transport
 * seam so artists, recordings, and ID mappings fail in the same way.
 */
export async function resolveArtist(artistName: string): Promise<MusicBrainzResolveResult | null> {
  const response = await fetchMusicBrainzJson(
    `${MB_ARTIST_SEARCH_URL}?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=3`,
  )
  if (!response.ok) return null

  if (!response.body || typeof response.body !== 'object') return null
  const rawArtists = (response.body as { artists?: unknown }).artists
  const artists = Array.isArray(rawArtists) ? rawArtists as MbSearchArtist[] : []
  if (artists.length === 0) return { matchedName: null, score: null, aliases: [] }

  const top = artists[0]!
  if (top.score < artistMinScore) return { matchedName: null, score: null, aliases: [] }

  const seen = new Set<string>([normalizeAliasKey(artistName)])
  const aliases: MusicBrainzArtistAlias[] = []
  if (normalizeAliasKey(top.name) !== normalizeAliasKey(artistName)) {
    aliases.push({ name: top.name, locale: null, primary: false })
    seen.add(normalizeAliasKey(top.name))
  }

  for (const alias of top.aliases ?? []) {
    const key = normalizeAliasKey(alias.name)
    if (seen.has(key)) continue
    const isLatin = /^[a-zA-Z\s'\-."!&/,()]+$/.test(alias.name.trim())
    if (alias.locale !== 'en' && !(isLatin && !alias.locale) && !alias.primary) continue
    seen.add(key)
    aliases.push({
      name: alias.name.trim(),
      locale: alias.locale ?? null,
      primary: alias.primary ?? false,
    })
  }

  return {
    matchedName: top.name,
    score: top.score,
    aliases,
    disambiguation: top.disambiguation,
  }
}

function normalizeAliasKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').trim()
}
