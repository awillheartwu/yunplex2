import plexApi from 'plex-api'
import type { PlexConfig } from './config/types'

interface PlexTrack {
  ratingKey: string
  title: string
  grandparentTitle: string
  parentTitle: string
  playlistItemID?: number
}

/** Strip punctuation, spaces, and special chars for fuzzy title comparison */
function stripTitle(s: string): string {
  return s.toLowerCase().replace(/[/\\:*?"'<>|&\s]+/g, '')
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

export async function refreshLibrary(section: string): Promise<string | null> {
  if (!client) throw new Error('Plex client not initialized')
  const sections = (await client.query('/library/sections')) as {
    MediaContainer?: { Directory?: { key: string; type: string; title: string }[] }
  }
  const dirs = sections.MediaContainer?.Directory ?? []
  const musicSection = dirs
    .filter((d) => d.type === 'artist')
    .find((d) => d.title === section)

  if (!musicSection) return null

  await client.query(`/library/sections/${musicSection.key}/refresh`)
  return musicSection.key
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
    .replace(/[/\\:*?"<>|]/g, ' ')
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

  // 2) Relaxed: stripped title + artist + album (lenient)
  const songStripped = stripTitle(coreTitle)
  const albumStripped = album ? stripTitle(album) : ''
  const relaxed = results.find((item) => {
    const pt = stripTitle(item.title)
    const titleMatch = pt === songStripped || pt.includes(songStripped) || songStripped.includes(pt)
    const artistMatch =
      item.grandparentTitle.toLowerCase() === artist.toLowerCase() ||
      item.grandparentTitle.toLowerCase().includes(artist.toLowerCase()) ||
      artist.toLowerCase().includes(item.grandparentTitle.toLowerCase())
    if (!titleMatch || !artistMatch) return false
    if (!albumStripped || !item.parentTitle) return true
    const pa = stripTitle(item.parentTitle)
    return albumStripped === pa || albumStripped.includes(pa) || pa.includes(albumStripped)
  })
  if (relaxed) return relaxed

  // 3) Last resort: title stripped match only (with loose album check)
  return results.find((item) => {
    const pt = stripTitle(item.title)
    if (!(pt === songStripped || pt.includes(songStripped) || songStripped.includes(pt))) return false
    if (!albumStripped || !item.parentTitle) return true
    const pa = stripTitle(item.parentTitle)
    return albumStripped === pa || albumStripped.includes(pa) || pa.includes(albumStripped)
  }) ?? null
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
  songName: string,
  album?: string,
): Promise<number> {
  if (!client) throw new Error('Plex client not initialized')
  const res = (await client.query(`/playlists/${playlistKey}/items`)) as {
    MediaContainer?: { Metadata?: { title: string; parentTitle?: string; playlistItemID?: number }[] }
  }

  const items = res.MediaContainer?.Metadata ?? []
  const albumStripped = album ? stripTitle(album) : ''
  // Search from end — newly inserted tracks are at the bottom
  const arr = Array.isArray(items) ? items : [items]
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i]
    if (item.title === songName) return item.playlistItemID ?? 0
    if (stripTitle(item.title) !== stripTitle(songName)) continue
    // Album disambiguation for same-title tracks
    if (albumStripped && item.parentTitle && stripTitle(item.parentTitle) !== albumStripped) continue
    return item.playlistItemID ?? 0
  }
  return 0
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
