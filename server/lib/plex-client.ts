import plexApi from 'plex-api'
import type { PlexConfig } from './config/types'
import { stripPunct, s2t } from './sync/matchers'

interface PlexTrack {
  ratingKey: string
  title: string
  grandparentTitle: string
  parentTitle: string
  playlistItemID?: number
}

/** Strip punctuation, spaces, and special chars for fuzzy title comparison */
function stripTitle(s: string): string {
  return stripPunct(s)
}
 
let client: any = null
let machineId = ''

export function createPlexClient(config: PlexConfig) {
  client = new plexApi({
    hostname: config.server,
    port: config.port,
    token: config.token,
    options: {
      identifier: 'com.plexapp.plugins.library',
      product: 'Plex Web',
      version: '3.0.1',
      deviceName: 'Plex Web (Chrome)',
      platform: 'Chrome',
      platformVersion: '37.0',
      device: 'Windows',
    },
  })
  return client
}

export async function initPlexClient(config: PlexConfig): Promise<string> {
  createPlexClient(config)
   
  const res = await client.query('/')
  machineId = (res as { MediaContainer?: { machineIdentifier?: string } }).MediaContainer
    ?.machineIdentifier ?? ''
  return machineId
}

export async function findPlaylist(playlistName: string) {
  if (!client) throw new Error('Plex client not initialized')
  const res = (await client.query('/playlists')) as {
    MediaContainer?: { Metadata?: { title: string; ratingKey: string }[] }
  }
  const metadata = res.MediaContainer?.Metadata ?? []
  return metadata.find((item) => item.title === playlistName) ?? null
}

/** Direct playlist lookup by ratingKey — used when ID binding is established */
export async function getPlaylistByRatingKey(ratingKey: string): Promise<{ title: string; ratingKey: string } | null> {
  if (!client) throw new Error('Plex client not initialized')
  try {
    const res = (await client.query(`/playlists/${ratingKey}`)) as {
      MediaContainer?: { Metadata?: { title: string; ratingKey: string }[] | { title: string; ratingKey: string } }
    }
    const raw = res.MediaContainer?.Metadata
    if (!raw) return null
    const item = Array.isArray(raw) ? raw[0] : raw
    return item ?? null
  } catch {
    return null
  }
}

export async function listPlaylists(): Promise<Array<{ title: string; ratingKey: string }>> {
  if (!client) throw new Error('Plex client not initialized')
  const res = (await client.query('/playlists')) as {
    MediaContainer?: { Metadata?: { title: string; ratingKey: string }[] }
  }
  const items = res.MediaContainer?.Metadata ?? []
  return Array.isArray(items) ? items : [items]
}

export async function createPlaylist(name: string, sectionKey: string): Promise<{ title: string; ratingKey: string }> {
  if (!client) throw new Error('Plex client not initialized')
  if (!machineId) throw new Error('Plex client not initialized (no machineId)')
  const uri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${sectionKey}`
  const res = (await client.postQuery(`/playlists?type=audio&title=${encodeURIComponent(name)}&smart=0&uri=${encodeURIComponent(uri)}`)) as {
    MediaContainer?: { Metadata?: Array<{ title: string; ratingKey: string }> }
  }
  const item = res.MediaContainer?.Metadata?.[0]
  if (!item) throw new Error('创建 Plex 歌单失败，未返回结果')
  return item
}

export async function getPlaylistTracks(
  playlistKey: string,
  limit: number,
): Promise<PlexTrack[]> {
  if (!client) throw new Error('Plex client not initialized')
  const res = (await client.query(`/playlists/${playlistKey}/items`)) as {
    MediaContainer?: { Metadata?: PlexTrack[] }
  }
  return (res.MediaContainer?.Metadata ?? []).slice(0, limit)
}

export async function getSectionKey(section: string): Promise<string | null> {
  if (!client) throw new Error('Plex client not initialized')
  const sections = (await client.query('/library/sections')) as {
    MediaContainer?: { Directory?: { key: string; type: string; title: string }[] }
  }
  const dirs = sections.MediaContainer?.Directory ?? []
  const musicSection = dirs
    .filter((d) => d.type === 'artist')
    .find((d) => d.title === section)
  return musicSection?.key ?? null
}

export async function refreshLibrary(sectionKey: string): Promise<void> {
  if (!client) throw new Error('Plex client not initialized')
  await client.query(`/library/sections/${sectionKey}/refresh`)
}

/** Scan only a specific directory — much faster than full library refresh */
export async function refreshPath(sectionKey: string, dirPath: string): Promise<void> {
  if (!client) throw new Error('Plex client not initialized')
  await client.query(`/library/sections/${sectionKey}/refresh?path=${encodeURIComponent(dirPath)}`)
}

export async function getSectionTrackCount(sectionKey: string): Promise<number> {
  if (!client) throw new Error('Plex client not initialized')
  const res = await client.query(
    `/library/sections/${sectionKey}/all?type=10&X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
  )
  return (res as { MediaContainer?: { totalSize?: number } }).MediaContainer?.totalSize ?? 0
}

export async function searchTrack(
  sectionKey: string,
  songName: string,
  artist: string,
  album: string,
): Promise<PlexTrack | null> {
  if (!client) throw new Error('Plex client not initialized')

  const coreTitle = songName
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .trim()

  const cleanTitle = coreTitle
    .replace(/[/\\:*?"<>|'""‘’'']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // ── Strategy A: search by artist (most reliable — title search often misses) ──
  const artistRes = await client.query(
    `/library/sections/${sectionKey}/all?type=10&artist.title=${encodeURIComponent(artist)}`,
  )
  const artistTracks = extractMetadata(artistRes)
  if (artistTracks.length) {
    const match = findMatch(artistTracks, songName, coreTitle, cleanTitle, artist, album)
    if (match) return match
  }

  // ── Strategy B: title-based search as fallback ──
  const titles = [...new Set([songName, coreTitle, cleanTitle].filter(Boolean))]
  for (const searchTitle of titles) {
    const res = await client.query(
      `/library/sections/${sectionKey}/search?type=10&title=${encodeURIComponent(searchTitle)}`,
    )
    const tracks = extractMetadata(res)
    const match = findMatch(tracks, songName, coreTitle, cleanTitle, artist, album)
    if (match) return match
  }

  return null
}

function extractMetadata(res: Record<string, unknown>): PlexTrack[] {
  const raw = (res as { MediaContainer?: { Metadata?: PlexTrack[] | PlexTrack } }).MediaContainer?.Metadata
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

function findMatch(
  results: PlexTrack[],
  songName: string,
  coreTitle: string,
  cleanTitle: string,
  artist: string,
  album: string,
): PlexTrack | null {
  if (!results.length) return null

  // 1) Exact triple match
  const exact = results.find(
    (item) =>
      item.title.toLowerCase() === songName.toLowerCase() &&
      item.grandparentTitle.toLowerCase() === artist.toLowerCase() &&
      item.parentTitle.toLowerCase() === album.toLowerCase(),
  )
  if (exact) return exact

  // 2) Relaxed: stripped title + artist (album optional — Netease/Plex often disagree)
  const songStripped = stripTitle(coreTitle)
  const relaxed = results.find((item) => {
    const pt = stripTitle(item.title)
    const titleMatch = pt === songStripped || pt.includes(songStripped) || songStripped.includes(pt)
    const artistMatch =
      item.grandparentTitle.toLowerCase() === artist.toLowerCase() ||
      item.grandparentTitle.toLowerCase().includes(artist.toLowerCase()) ||
      artist.toLowerCase().includes(item.grandparentTitle.toLowerCase())
    return titleMatch && artistMatch
  })
  if (relaxed) return relaxed

  // 3) Relaxed with s2t title conversion — handles simplified vs traditional Chinese
  // (e.g. Netease "苦难精算师" vs Plex "苦難精算師")
  const tCoreTitle = s2t(coreTitle)
  if (tCoreTitle !== coreTitle) {
    const tStripped = stripTitle(tCoreTitle)
    const s2tMatch = results.find((item) => {
      const pt = stripTitle(item.title)
      const titleMatch = pt === tStripped || pt.includes(tStripped) || tStripped.includes(pt)
      const artistMatch =
        item.grandparentTitle.toLowerCase() === artist.toLowerCase() ||
        item.grandparentTitle.toLowerCase().includes(artist.toLowerCase()) ||
        artist.toLowerCase().includes(item.grandparentTitle.toLowerCase())
      return titleMatch && artistMatch
    })
    if (s2tMatch) return s2tMatch
  }

  // NOTE: no pure-title fallback — the relaxed + s2t artist check above covers
  // artist name variations and Chinese character variants. Matching by title
  // alone causes false positives (e.g. "The Weeknd - Secrets" vs "OneRepublic - Secrets").
  return null
}

export async function insertTrackIntoPlaylist(
  playlistKey: string,
  trackRatingKey: string,
): Promise<void> {
  if (!client) throw new Error('Plex client not initialized')
  await client.putQuery(
    `/playlists/${playlistKey}/items?uri=server%3A%2F%2F${machineId}%2Fcom.plexapp.plugins.library%2Flibrary%2Fmetadata%2F${trackRatingKey}&includeExternalMedia=1&`,
  )
}

export async function getPlaylistItemId(
  playlistKey: string,
  trackRatingKey: string,
): Promise<number> {
  if (!client) throw new Error('Plex client not initialized')
  const res = (await client.query(`/playlists/${playlistKey}/items`)) as {
    MediaContainer?: { Metadata?: { ratingKey: string; playlistItemID?: number }[] }
  }

  const items = res.MediaContainer?.Metadata ?? []
  const arr = Array.isArray(items) ? items : [items]
  // Direct match by ratingKey — the library track ID we just inserted
  const found = arr.find((item) => item.ratingKey === trackRatingKey)
  return found?.playlistItemID ?? 0
}

export async function movePlaylistItemToTop(
  playlistKey: string,
  playlistItemId: number,
): Promise<void> {
  if (!client) throw new Error('Plex client not initialized')
  await client.putQuery(`/playlists/${playlistKey}/items/${playlistItemId}/move`)
}

export async function movePlaylistItemAfter(
  playlistKey: string,
  playlistItemId: number,
  afterItemId: number,
): Promise<void> {
  if (!client) throw new Error('Plex client not initialized')
  await client.putQuery(`/playlists/${playlistKey}/items/${playlistItemId}/move?after=${afterItemId}`)
}

/** Direct metadata lookup by ratingKey — used to verify cached tracks still exist */
export async function getTrackByRatingKey(ratingKey: string): Promise<PlexTrack | null> {
  if (!client) throw new Error('Plex client not initialized')
  try {
    const res = (await client.query(`/library/metadata/${ratingKey}`)) as {
      MediaContainer?: { Metadata?: PlexTrack[] | PlexTrack }
    }
    const raw = res.MediaContainer?.Metadata
    if (!raw) return null
    return Array.isArray(raw) ? raw[0] ?? null : raw
  } catch {
    return null
  }
}

export async function removeTrackFromPlaylist(
  playlistKey: string,
  playlistItemId: number,
): Promise<void> {
  if (!client) throw new Error('Plex client not initialized')
  await client.deleteQuery(`/playlists/${playlistKey}/items/${playlistItemId}`)
}
