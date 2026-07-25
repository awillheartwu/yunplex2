import plexApi from 'plex-api'
import type { PlexConfig } from './config/types'
import { stripPunct, s2t, t2s, normalizeForSearch, titleIdentityDescriptorsCompatible } from './sync/matchers'
import { isArtistNameMatch } from './sync/artist-match'

export interface PlexTrack {
  ratingKey: string
  title: string
  grandparentTitle: string
  parentTitle: string
  thumb?: string
  addedAt?: number | string
  playlistItemID?: number
  originalTitle?: string
  index?: number | string
  duration?: number
  Guid?: Array<{ id?: string }> | { id?: string }
  guid?: string
  Media?: Array<{
    Part?: Array<{
      file?: string
    }>
  }>
}

export interface PlexTrackMusicBrainzIdentity {
  explicitRecordingId: string | null
  untypedIds: string[]
  rawGuids: string[]
}

export interface PlexTrackNeteaseIdentity {
  provider: 'wangyiyun'
  artistId: number
  albumId: number
  discNumber: number | null
  trackNumber: number
  rawGuid: string
}

const MUSICBRAINZ_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const EXPLICIT_RECORDING_PATTERNS = [
  new RegExp(`(?:https?://)?musicbrainz\\.org/recording/(${MUSICBRAINZ_UUID})(?:[/?#]|$)`, 'i'),
  new RegExp(`(?:mbid|musicbrainz)://recording/(${MUSICBRAINZ_UUID})(?:[/?#]|$)`, 'i'),
]
const UNTYPED_MBID_PATTERN = new RegExp(`^mbid://(${MUSICBRAINZ_UUID})(?:[/?#]|$)`, 'i')

/** Parse Plex GUIDs without assuming that a generic mbid:// UUID is a recording. */
export function getPlexTrackMusicBrainzIdentity(track: PlexTrack): PlexTrackMusicBrainzIdentity {
  const rawGuids = getPlexGuidValues(track)
  const untypedIds = new Set<string>()
  let explicitRecordingId: string | null = null

  for (const guid of rawGuids) {
    for (const pattern of EXPLICIT_RECORDING_PATTERNS) {
      const match = guid.match(pattern)
      if (match?.[1]) {
        explicitRecordingId ??= match[1].toLowerCase()
        break
      }
    }
    const untyped = guid.match(UNTYPED_MBID_PATTERN)?.[1]
    if (untyped) untypedIds.add(untyped.toLowerCase())
  }

  return { explicitRecordingId, untypedIds: [...untypedIds], rawGuids }
}

function getPlexGuidValues(track: PlexTrack): string[] {
  const values = [
    track.guid,
    ...(Array.isArray(track.Guid) ? track.Guid.map(guid => guid.id) : [track.Guid?.id]),
  ].filter((value): value is string => Boolean(value?.trim()))
  return [...new Set(values.map(value => value.trim()))]
}

/** Parse the typed identity emitted by the Plex WangYiYun metadata agent. */
export function getPlexTrackNeteaseIdentity(track: PlexTrack): PlexTrackNeteaseIdentity | null {
  const pattern = /^com\.plexapp\.agents\.wangyiyun:\/\/(\d+)\/(\d+)\/(-?\d+)\/(\d+)(?:[/?#]|$)/i
  for (const rawGuid of getPlexGuidValues(track)) {
    const match = rawGuid.match(pattern)
    if (!match) continue
    const artistId = Number(match[1])
    const albumId = Number(match[2])
    const rawDiscNumber = Number(match[3])
    const trackNumber = Number(match[4])
    if (![artistId, albumId, rawDiscNumber, trackNumber].every(Number.isSafeInteger)) continue
    if (artistId <= 0 || albumId <= 0 || trackNumber <= 0) continue
    return {
      provider: 'wangyiyun',
      artistId,
      albumId,
      discNumber: rawDiscNumber > 0 ? rawDiscNumber : null,
      trackNumber,
      rawGuid,
    }
  }
  return null
}

export function getPlexTrackRecordingId(track: PlexTrack): string | null {
  return getPlexTrackMusicBrainzIdentity(track).explicitRecordingId
}

/** Strip punctuation, spaces, and special chars for fuzzy title comparison */
function stripTitle(s: string): string {
  return stripPunct(s)
}
 
let client: any = null
let machineId = ''
let clientFingerprint = ''

const PLEX_PATH_INDEX_PAGE_SIZE = 500
const PLEX_PATH_INDEX_TTL_MS = 30_000
interface PlexPathIndex {
  exact: Map<string, PlexTrack[]>
  folded: Map<string, { exactPaths: Set<string>; tracks: PlexTrack[] }>
}
const sectionPathIndexCache = new Map<string, { expiresAt: number; index: PlexPathIndex }>()
const sectionPathIndexBuilds = new Map<string, Promise<PlexPathIndex>>()
const sectionPathIndexGenerations = new Map<string, number>()
let pathIndexEpoch = 0

function normalizePlexFilePath(filePath: string): string {
  return filePath.normalize('NFC').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
}

function foldPlexFilePath(filePath: string): string {
  return normalizePlexFilePath(filePath).toLowerCase()
}

async function buildSectionPathIndex(sectionKey: string): Promise<PlexPathIndex> {
  if (!client) throw new Error('Plex client not initialized')

  // Keep one snapshot on one Plex client even if configuration is reloaded
  // while pagination is in progress. Epoch checks below prevent stale caching.
  const indexClient = client
  const index: PlexPathIndex = { exact: new Map(), folded: new Map() }
  let start = 0

  while (true) {
    const res = (await indexClient.query(
      `/library/sections/${sectionKey}/all?type=10&includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PLEX_PATH_INDEX_PAGE_SIZE}`,
    )) as {
      MediaContainer?: {
        totalSize?: number | string
        Metadata?: PlexTrack[] | PlexTrack
      }
    }
    const tracks = extractMetadata(res)
    for (const track of tracks) {
      const indexedPaths = new Set<string>()
      for (const media of track.Media ?? []) {
        for (const part of media.Part ?? []) {
          if (!part.file) continue
          const key = normalizePlexFilePath(part.file)
          if (indexedPaths.has(key)) continue
          indexedPaths.add(key)
          const candidates = index.exact.get(key)
          if (!candidates) index.exact.set(key, [track])
          else if (!candidates.some(candidate => candidate.ratingKey === track.ratingKey)) candidates.push(track)
          const foldedKey = foldPlexFilePath(key)
          const folded = index.folded.get(foldedKey) ?? { exactPaths: new Set<string>(), tracks: [] }
          folded.exactPaths.add(key)
          if (!folded.tracks.some(candidate => candidate.ratingKey === track.ratingKey)) folded.tracks.push(track)
          index.folded.set(foldedKey, folded)
        }
      }
    }

    if (tracks.length === 0) break
    start += tracks.length
    const totalSize = Number(res.MediaContainer?.totalSize)
    if (Number.isFinite(totalSize) && start >= totalSize) break
    if (!Number.isFinite(totalSize) && tracks.length < PLEX_PATH_INDEX_PAGE_SIZE) break
  }

  return index
}

async function getSectionPathIndex(sectionKey: string): Promise<PlexPathIndex> {
  const cached = sectionPathIndexCache.get(sectionKey)
  if (cached && cached.expiresAt > Date.now()) return cached.index

  const inFlight = sectionPathIndexBuilds.get(sectionKey)
  if (inFlight) return inFlight

  const epoch = pathIndexEpoch
  const generation = sectionPathIndexGenerations.get(sectionKey) ?? 0
  const build = buildSectionPathIndex(sectionKey)
    .then((index) => {
      if (epoch === pathIndexEpoch && generation === (sectionPathIndexGenerations.get(sectionKey) ?? 0)) {
        sectionPathIndexCache.set(sectionKey, { expiresAt: Date.now() + PLEX_PATH_INDEX_TTL_MS, index })
      }
      return index
    })
    .finally(() => {
      if (sectionPathIndexBuilds.get(sectionKey) === build) sectionPathIndexBuilds.delete(sectionKey)
    })
  sectionPathIndexBuilds.set(sectionKey, build)
  return build
}

function invalidateSectionPathIndex(sectionKey: string): void {
  sectionPathIndexCache.delete(sectionKey)
  sectionPathIndexBuilds.delete(sectionKey)
  sectionPathIndexGenerations.set(sectionKey, (sectionPathIndexGenerations.get(sectionKey) ?? 0) + 1)
}

function invalidateAllSectionPathIndexes(): void {
  pathIndexEpoch += 1
  sectionPathIndexCache.clear()
  sectionPathIndexBuilds.clear()
  sectionPathIndexGenerations.clear()
}

export function createPlexClient(config: PlexConfig) {
  const nextFingerprint = JSON.stringify([config.server, config.port, config.token, config.section])
  if (clientFingerprint && clientFingerprint !== nextFingerprint) {
    invalidateAllSectionPathIndexes()
    machineId = ''
  }
  clientFingerprint = nextFingerprint
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
  const nextMachineId = (res as { MediaContainer?: { machineIdentifier?: string } }).MediaContainer
    ?.machineIdentifier ?? ''
  if (machineId && nextMachineId && machineId !== nextMachineId) invalidateAllSectionPathIndexes()
  machineId = nextMachineId
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

export function isPlexNotFoundError(error: unknown): boolean {
  if (!error) return false
  const candidate = error as {
    status?: number
    statusCode?: number
    responseCode?: number
    response?: { status?: number; statusCode?: number }
    message?: string
  }
  const status = candidate.status
    ?? candidate.statusCode
    ?? candidate.responseCode
    ?? candidate.response?.status
    ?? candidate.response?.statusCode
  if (status === 404) return true
  const message = error instanceof Error ? error.message : String(error)
  return /\b(?:response|status)(?:\s+code)?\s*[:=]?\s*404\b/i.test(message)
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
  } catch (error) {
    if (isPlexNotFoundError(error)) return null
    throw error
  }
}

export interface PlexPlaylistSnapshot {
  playlist: { title: string; ratingKey: string }
  updatedAt: number | null
  tracks: PlexTrack[]
}

/**
 * Reads a bound playlist as one lifecycle-aware snapshot.
 *
 * A playlist can be deleted between the metadata and items requests. Returning
 * null for either 404 lets synchronization rebuild the target, while transport
 * and server failures remain visible and cannot create duplicate playlists.
 */
export async function getPlaylistSnapshotByRatingKey(
  ratingKey: string,
  limit: number,
): Promise<PlexPlaylistSnapshot | null> {
  const playlist = await getPlaylistByRatingKey(ratingKey)
  if (!playlist) return null
  try {
    const [updatedAt, tracks] = await Promise.all([
      getPlaylistUpdatedAt(ratingKey),
      getPlaylistTracks(ratingKey, limit),
    ])
    return { playlist, updatedAt, tracks }
  } catch (error) {
    if (isPlexNotFoundError(error)) return null
    throw error
  }
}

export async function getPlaylistUpdatedAt(ratingKey: string): Promise<number | null> {
  if (!client) throw new Error('Plex client not initialized')
  try {
    const res = (await client.query(`/playlists/${ratingKey}`)) as {
      MediaContainer?: { Metadata?: Array<{ updatedAt?: number | string }> | { updatedAt?: number | string } }
    }
    const raw = res.MediaContainer?.Metadata
    const item = Array.isArray(raw) ? raw[0] : raw
    if (!item?.updatedAt) return null
    const value = typeof item.updatedAt === 'string' ? parseInt(item.updatedAt, 10) : item.updatedAt
    return Number.isFinite(value) ? value : null
  } catch (error) {
    if (isPlexNotFoundError(error)) return null
    throw error
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
  const boundedLimit = Math.max(0, Math.floor(limit))
  if (boundedLimit === 0) return []

  const tracks: PlexTrack[] = []
  const pageSize = Math.min(500, boundedLimit)
  let start = 0
  while (tracks.length < boundedLimit) {
    const remaining = boundedLimit - tracks.length
    const size = Math.min(pageSize, remaining)
    const res = (await client.query(
      `/playlists/${playlistKey}/items?X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`,
    )) as {
      MediaContainer?: {
        totalSize?: number | string
        Metadata?: PlexTrack[] | PlexTrack
      }
    }
    const page = extractMetadata(res)
    tracks.push(...page.slice(0, remaining))
    if (page.length === 0) break
    start += page.length
    const totalSize = Number(res.MediaContainer?.totalSize)
    if (Number.isFinite(totalSize) && start >= totalSize) break
    if (!Number.isFinite(totalSize) && page.length < size) break
  }
  return tracks
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
  invalidateSectionPathIndex(sectionKey)
}

/** Scan only a specific directory — much faster than full library refresh */
export async function refreshPath(sectionKey: string, dirPath: string): Promise<void> {
  if (!client) throw new Error('Plex client not initialized')
  await client.query(`/library/sections/${sectionKey}/refresh?path=${encodeURIComponent(dirPath)}`)
  invalidateSectionPathIndex(sectionKey)
}

export async function getSectionTrackCount(sectionKey: string): Promise<number> {
  if (!client) throw new Error('Plex client not initialized')
  const res = await client.query(
    `/library/sections/${sectionKey}/all?type=10&X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
  )
  return (res as { MediaContainer?: { totalSize?: number } }).MediaContainer?.totalSize ?? 0
}

export async function getRecentlyAddedTracks(sectionKey: string, limit = 5): Promise<PlexTrack[]> {
  if (!client) throw new Error('Plex client not initialized')
  const size = Math.min(Math.max(limit, 1), 100)
  const res = (await client.query(
    `/library/sections/${sectionKey}/recentlyAdded?type=10&X-Plex-Container-Start=0&X-Plex-Container-Size=${size}`,
  )) as {
    MediaContainer?: { Metadata?: PlexTrack[] | PlexTrack }
  }
  return extractMetadata(res).slice(0, size)
}

export async function searchTrack(
  sectionKey: string,
  songName: string,
  artistCandidates: string[],
  album: string,
): Promise<PlexTrack | null> {
  if (!client) throw new Error('Plex client not initialized')

  const coreTitle = songName
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .trim()

  const cleanTitle = coreTitle.replace(/[/\\:*?"<>|']/g, " ").replace(/\\s+/g, " ").trim()
  const searchTitle = normalizeForSearch(songName)

  // ── Strategy A: search by every artist candidate (most reliable) ──
  for (const candidate of artistCandidates) {
    const artistRes = await client.query(
      `/library/sections/${sectionKey}/all?type=10&artist.title=${encodeURIComponent(candidate)}`,
    )
    const artistTracks = extractMetadata(artistRes)
    if (artistTracks.length) {
      const match = findMatch(artistTracks, songName, coreTitle, cleanTitle, artistCandidates, album)
      if (match) return match
    }
  }

  // ── Strategy B: title-based search with candidate artist matching ──
  const titles = [...new Set([songName, coreTitle, cleanTitle, searchTitle].filter(Boolean))]
  for (const t of titles) {
    const res = await client.query(
      `/library/sections/${sectionKey}/search?type=10&title=${encodeURIComponent(t)}`,
    )
    const tracks = extractMetadata(res)
    const match = findMatch(tracks, songName, coreTitle, cleanTitle, artistCandidates, album)
    if (match) return match
  }

  return null
}

export async function searchTracksByTitle(sectionKey: string, songName: string): Promise<PlexTrack[]> {
  if (!client) throw new Error('Plex client not initialized')

  const coreTitle = songName
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .trim()
  const cleanTitle = coreTitle.replace(/[/\\:*?"<>|']/g, ' ').replace(/\\s+/g, ' ').trim()
  const searchTitle = normalizeForSearch(songName)
  const traditionalTitle = s2t(songName)
  const simplifiedTitle = t2s(songName)

  const titles = [...new Set([songName, coreTitle, cleanTitle, searchTitle, traditionalTitle, simplifiedTitle].filter(Boolean))]
  const seen = new Set<string>()
  const matches: PlexTrack[] = []

  for (const title of titles) {
    const res = await client.query(
      `/library/sections/${sectionKey}/search?type=10&title=${encodeURIComponent(title)}`,
    )
    for (const track of extractMetadata(res)) {
      if (seen.has(track.ratingKey)) continue
      seen.add(track.ratingKey)
      matches.push(track)
    }
  }

  return matches
}

export async function searchTracksByArtists(sectionKey: string, artistCandidates: string[]): Promise<PlexTrack[]> {
  if (!client) throw new Error('Plex client not initialized')

  const seen = new Set<string>()
  const matches: PlexTrack[] = []

  for (const artist of [...new Set(artistCandidates.map((value) => value.trim()).filter(Boolean))]) {
    const res = await client.query(
      `/library/sections/${sectionKey}/all?type=10&artist.title=${encodeURIComponent(artist)}`,
    )
    for (const track of extractMetadata(res)) {
      if (seen.has(track.ratingKey)) continue
      seen.add(track.ratingKey)
      matches.push(track)
    }
  }

  return matches
}

export async function searchTracksByAlbum(sectionKey: string, album: string): Promise<PlexTrack[]> {
  if (!client) throw new Error('Plex client not initialized')

  const albumNames = [...new Set([
    album,
    normalizeForSearch(album),
    s2t(album),
    t2s(album),
  ].map((value) => value.trim()).filter(Boolean))]
  const seen = new Set<string>()
  const matches: PlexTrack[] = []

  for (const albumName of albumNames) {
    const res = await client.query(
      `/library/sections/${sectionKey}/all?type=10&album.title=${encodeURIComponent(albumName)}`,
    )
    for (const track of extractMetadata(res)) {
      if (seen.has(track.ratingKey)) continue
      seen.add(track.ratingKey)
      matches.push(track)
    }
  }

  return matches
}

/** Resolve every Plex library candidate sharing the same normalized media path. */
export async function findTracksByFilePath(sectionKey: string, filePath: string): Promise<PlexTrack[]> {
  if (!client || !filePath) return []
  try {
    const index = await getSectionPathIndex(sectionKey)
    const normalized = normalizePlexFilePath(filePath)
    const exact = index.exact.get(normalized)
    if (exact) return [...exact]
    const folded = index.folded.get(foldPlexFilePath(normalized))
    // Case folding is a fallback only. A case-sensitive Plex library may
    // legitimately contain both variants, so ambiguity must remain review-only.
    if (!folded || folded.exactPaths.size !== 1 || folded.tracks.length !== 1) return []
    return [...folded.tracks]
  }
  catch { return [] }
}

/** Resolve the first durable Plex library item by its media file path after a rescan. */
export async function findTrackByFilePath(sectionKey: string, filePath: string): Promise<PlexTrack | null> {
  return (await findTracksByFilePath(sectionKey, filePath))[0] ?? null
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
  artistCandidates: string[],
  album: string,
): PlexTrack | null {
  if (!results.length) return null

  // 1) Exact triple match — title + any candidate artist + album
  const exact = results.find(
    (item) =>
      titleVariantsMatch(item.title, songName) &&
      artistCandidates.some((c) => item.grandparentTitle.toLowerCase() === c.toLowerCase()) &&
      titleVariantsMatch(item.parentTitle, album),
  )
  if (exact) return exact

  // 2) Relaxed: stripped title + candidate artist match
  const songStripped = buildTitleMatchVariants(coreTitle)
  const relaxed = results.find((item) => {
    const pt = buildTitleMatchVariants(item.title)
    const titleMatch = pt.some((variant) => songStripped.some((candidate) => variant === candidate || variant.includes(candidate) || candidate.includes(variant)))
    const artistMatch = artistCandidates.some((c) => isArtistNameMatch(item.grandparentTitle, c))
    return titleMatch && artistMatch
  })
  if (relaxed) return relaxed

  // 3) s2t conversion: try simplified→traditional for each candidate
  const tCoreTitle = s2t(coreTitle)
  const needS2t = artistCandidates.some((c) => {
    const tc = s2t(c)
    return tc !== c || tCoreTitle !== coreTitle
  })
  if (needS2t) {
    const tStripped = buildTitleMatchVariants(tCoreTitle)
    const s2tMatch = results.find((item) => {
      const pt = buildTitleMatchVariants(item.title)
      const titleMatch = pt.some((variant) => tStripped.some((candidate) => variant === candidate || variant.includes(candidate) || candidate.includes(variant)))
      const artistMatch = artistCandidates.some((c) => isArtistNameMatch(item.grandparentTitle, s2t(c)))
      return titleMatch && artistMatch
    })
    if (s2tMatch) return s2tMatch
  }

  return null
}

export function buildTitleMatchVariants(input: string): string[] {
  const variants = [input, s2t(input), t2s(input)]
    .map((value) => stripTitle(normalizeForSearch(value)))
    .filter(Boolean)
  return [...new Set(variants)]
}

export function titleVariantsMatch(left: string, right: string): boolean {
  if (!titleIdentityDescriptorsCompatible(left, right)) return false
  const leftVariants = buildTitleMatchVariants(left)
  const rightVariants = buildTitleMatchVariants(right)
  return leftVariants.some((leftVariant) => rightVariants.some((rightVariant) => leftVariant === rightVariant))
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
  const ids = await getPlaylistItemIds(playlistKey, trackRatingKey)
  return ids[0] ?? 0
}

export async function getPlaylistItemIds(
  playlistKey: string,
  trackRatingKey: string,
): Promise<number[]> {
  if (!client) throw new Error('Plex client not initialized')
  const res = (await client.query(`/playlists/${playlistKey}/items`)) as {
    MediaContainer?: { Metadata?: { ratingKey: string; playlistItemID?: number }[] }
  }

  const items = res.MediaContainer?.Metadata ?? []
  const arr = Array.isArray(items) ? items : [items]
  return arr
    .filter((item) => item.ratingKey === trackRatingKey && typeof item.playlistItemID === 'number')
    .map((item) => item.playlistItemID!)
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

/** Fetch rating keys in bounded Plex requests instead of one request per row. */
export async function getTracksByRatingKeys(ratingKeys: string[]): Promise<Map<string, PlexTrack>> {
  if (!client) throw new Error('Plex client not initialized')
  const keys = [...new Set(ratingKeys.map(key => key.trim()).filter(Boolean))]
  const result = new Map<string, PlexTrack>()
  const batchSize = 50
  for (let offset = 0; offset < keys.length; offset += batchSize) {
    const batch = keys.slice(offset, offset + batchSize)
    try {
      const response = (await client.query(`/library/metadata/${batch.join(',')}`)) as {
        MediaContainer?: { Metadata?: PlexTrack[] | PlexTrack }
      }
      const raw = response.MediaContainer?.Metadata
      const tracks = raw ? (Array.isArray(raw) ? raw : [raw]) : []
      for (const track of tracks) result.set(String(track.ratingKey), track)
    } catch {
      // Some older Plex builds do not support comma-separated metadata keys.
      // Fall back only for this bounded chunk while keeping the public API
      // batched and allowing callers to update rows in one DB transaction.
      const tracks = await Promise.all(batch.map(key => getTrackByRatingKey(key)))
      tracks.forEach((track, index) => {
        if (track) result.set(batch[index]!, track)
      })
    }
  }
  return result
}

export async function getTrackFilePathByRatingKey(ratingKey: string): Promise<string | null> {
  return (await getTrackFilePathsByRatingKey(ratingKey))[0] ?? null
}

export async function getTrackFilePathsByRatingKey(ratingKey: string): Promise<string[]> {
  const track = await getTrackByRatingKey(ratingKey)
  return track?.Media?.flatMap(media =>
    media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [],
  ) ?? []
}

export async function removeTrackFromPlaylist(
  playlistKey: string,
  playlistItemId: number,
): Promise<void> {
  if (!client) throw new Error('Plex client not initialized')
  await client.deleteQuery(`/playlists/${playlistKey}/items/${playlistItemId}`)
}
