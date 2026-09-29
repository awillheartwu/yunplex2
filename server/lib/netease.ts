import pkg from 'NeteaseCloudMusicApi'
import type { LyricOrder } from './config/types'

const { login_status, song_url_v1, lyric_new, song_detail, album, user_playlist, album_sublist, playlist_detail } = pkg

type NeteaseQualityLevel = Parameters<typeof song_url_v1>[0]['level']

// The package models this request field as a nominal const enum, while the
// upstream API also accepts the documented string values (including higher).
function toNeteaseQualityLevel(level: string): NeteaseQualityLevel {
  return level as NeteaseQualityLevel
}

interface NeteaseResponse<Body> {
  body?: Body
}

interface SongDetailBody {
  songs?: RawSong[]
}

interface LegacySongDetail {
  id?: number
  album?: { publishTime?: number }
}

interface UserPlaylistResponseItem {
  id: number
  name: string
  trackCount: number
  playCount: number
  coverImgUrl?: string
  creator?: { nickname?: string; userId?: number }
  subscribed?: boolean
}

interface UserAlbumResponseItem {
  id: number
  name: string
  size?: number
  picUrl?: string
  artists?: Array<{ name?: string }>
  artist?: { name?: string }
  publishTime?: number
  subTime?: number
}

export interface NeteaseSong {
  id: number
  name: string
  no: number
  dt: number
  disc: string
  artists: { id?: number; name: string }[]
  album: {
    id: number
    name: string
    picUrl: string
    publishTime: number
    artist?: { id?: number; name: string }
  }
  sync?: boolean
  playlistItemID?: number
}

export interface AlbumDetail {
  name: string
  picUrl: string
  publishTime: number
  company: string
  description: string
  genre: string
  subType: string
  artist: string
  size: number
  totalDiscs: number
  type: string
  artistImgUrl: string
  info?: { comment?: { threadId?: string } }
}

const QUALITY_LEVELS: Record<string, string> = {
  standard: 'standard',
  higher: 'higher',
  exhigh: 'exhigh',
  lossless: 'lossless',
  hires: 'hires',
  jyeffect: 'jyeffect',
  jymaster: 'jymaster',
}

export async function checkCookie(cookie: string): Promise<{
  valid: boolean
  profile?: { userId: number; nickname: string }
}> {
  try {
    const res = await login_status({ cookie })
    const data = (res as { body?: { data?: { code?: number; profile?: { userId: number; nickname: string } } } }).body?.data
    if (data?.code === 200) {
      return { valid: true, profile: data.profile }
    }
    return { valid: false }
  } catch {
    return { valid: false }
  }
}

export async function fetchPlaylistSongs(
  playlistId: number,
  limit: number | undefined,
  cookie: string,
  options: { preserveArtistNames?: boolean } = {},
): Promise<{
  songs: NeteaseSong[]
  trackUpdateTime: number | null
  trackIds: { id: number }[]
  /** Complete playlist membership before syncLimit is applied. */
  allTrackIds: { id: number }[]
  playlistName: string | null
  playlist: {
    name: string
    coverUrl: string
    creatorName: string
    description: string
    trackCount: number
    updateTime: number | null
  } | null
}> {
  const response = await playlist_detail({ id: playlistId, cookie })
  const body = (response as {
    status?: number
    body?: {
      code?: number
      playlist?: {
        name?: string
        coverImgUrl?: string
        creator?: { nickname?: string }
        description?: string
        trackCount?: number
        trackIds: { id: number }[]
        trackUpdateTime?: number
        updateTime?: number
      }
    }
  }).body
  const status = (response as { status?: number }).status
  if ((typeof status === 'number' && status >= 400) || (body?.code && body.code !== 200)) {
    throw new Error(`获取网易云歌单失败（HTTP ${status ?? body?.code ?? 'unknown'}）`)
  }
  if (!body?.playlist || !Array.isArray(body.playlist.trackIds)) {
    throw new Error('网易云歌单响应不完整：缺少 playlist.trackIds，已中止同步以防误删')
  }
  const playlistBody = body as {
    code?: number
    playlist?: {
      name?: string
      coverImgUrl?: string
      creator?: { nickname?: string }
      description?: string
      trackCount?: number
      trackIds: { id: number }[]
      trackUpdateTime?: number
      updateTime?: number
    }
  }
  const allIds = playlistBody.playlist?.trackIds ?? []
  const trackUpdateTime = playlistBody.playlist?.trackUpdateTime ?? null
  const playlistName = playlistBody.playlist?.name ?? null
  const playlist = playlistBody.playlist
    ? {
        name: playlistBody.playlist.name ?? `歌单 ${playlistId}`,
        coverUrl: playlistBody.playlist.coverImgUrl ?? '',
        creatorName: playlistBody.playlist.creator?.nickname ?? '',
        description: playlistBody.playlist.description ?? '',
        trackCount: playlistBody.playlist.trackCount ?? allIds.length,
        updateTime: playlistBody.playlist.updateTime ?? trackUpdateTime,
      }
    : null
  const slicedIds = limit && limit > 0 ? allIds.slice(0, limit) : allIds

  if (slicedIds.length === 0) {
    return { songs: [], trackUpdateTime, trackIds: slicedIds, allTrackIds: allIds, playlistName, playlist }
  }

  // Batch song_detail — API rejects too many IDs at once (safe limit: ~500)
  const BATCH_SIZE = 400
  const songsById = new Map<number, NeteaseSong>()

  for (let offset = 0; offset < slicedIds.length; offset += BATCH_SIZE) {
    const batch = slicedIds.slice(offset, offset + BATCH_SIZE)
    const ids = batch.map((t) => String(t.id)).join(',')

    const [v3Res, oldRes] = await Promise.all([
      song_detail({ ids, cookie }),
      fetch(`http://music.163.com/api/song/detail/?id=&ids=[${ids}]`),
    ])

    const data = (v3Res as NeteaseResponse<SongDetailBody>).body
    const oldData = oldRes.ok
      ? await oldRes.json().catch(() => undefined) as { songs?: LegacySongDetail[] } | undefined
      : undefined

    if (data?.songs) {
      for (const s of data.songs) {
        // NetEase occasionally returns a nominal song row whose identity text
        // is explicitly null (typically for unavailable/withdrawn media).
        // Keep its authoritative trackId, but leave the detail unresolved so
        // Source Convergence applies deletion protection instead of inventing
        // a path such as "null/未知专辑" or crashing alias normalization.
        if (findInvalidRawSongField(s)) continue
        const song = mapRawSong(s, options)
        // Fallback: old API often has publishTime when v3 doesn't
        if (!song.album.publishTime && oldData?.songs) {
          const match = oldData.songs.find(os => os.id === s.id)
          if (match?.album?.publishTime) song.album.publishTime = match.album.publishTime
        }
        songsById.set(song.id, song)
      }
    }
  }

  // The detail endpoint may reorder or omit rows. Reconstruct the authoritative
  // playlist order from trackIds and preserve duplicate occurrences. Missing
  // IDs remain visible to the sync service through trackIds for deletion safety.
  const orderedSongs = slicedIds.flatMap(track => {
    const song = songsById.get(track.id)
    return song ? [song] : []
  })
  return { songs: orderedSongs, trackUpdateTime, trackIds: slicedIds, allTrackIds: allIds, playlistName, playlist }
}

interface RawSong {
  id: number
  name: string
  no?: number
  dt?: number
  cd?: string
  publishTime?: number
  ar?: { id?: number; name: string }[]
  al?: {
    id: number
    name: string
    picUrl: string
    publishTime?: number
    artist?: { id?: number; name: string }
  }
}

function findInvalidRawSongField(raw: RawSong): string | null {
  const candidate = raw as unknown as {
    name?: unknown
    ar?: unknown
    al?: unknown
  }
  if (typeof candidate.name !== 'string') return 'song.name'
  if (candidate.ar !== undefined) {
    if (!Array.isArray(candidate.ar)) return 'song.ar'
    for (const [index, artist] of candidate.ar.entries()) {
      const name = artist && typeof artist === 'object'
        ? (artist as { name?: unknown }).name
        : undefined
      if (typeof name !== 'string') return `song.ar[${index}].name`
    }
  }
  if (candidate.al !== undefined) {
    if (!candidate.al || typeof candidate.al !== 'object') return 'song.al'
    const album = candidate.al as { name?: unknown; artist?: unknown }
    if (typeof album.name !== 'string') return 'song.al.name'
    if (album.artist !== undefined && album.artist !== null) {
      if (typeof album.artist !== 'object') return 'song.al.artist'
      if (typeof (album.artist as { name?: unknown }).name !== 'string') return 'song.al.artist.name'
    }
  }
  return null
}

// ── Artist alias state ──
let artistAliases: Record<string, string> = {}
let normalizedAliases: Record<string, string> = {}
let applyAliasToAlbum = false

function normalizeAliasKey(name: string): string {
  return name.trim().replace(/\s+/g, '')
}

export function setArtistAliases(aliases: Record<string, string>, applyToAlbum: boolean) {
  artistAliases = aliases || {}
  applyAliasToAlbum = applyToAlbum
  // Pre-build a normalized lookup so "艾热 AIR" matches "艾热AIR"
  normalizedAliases = {}
  for (const [key, val] of Object.entries(artistAliases)) {
    normalizedAliases[normalizeAliasKey(key)] = val
  }
}

export function getArtistAliases() {
  return { aliases: artistAliases, applyToAlbum: applyAliasToAlbum }
}

function applyAlias(name: string): string {
  // Exact match first
  if (Object.hasOwn(artistAliases, name)) return artistAliases[name]!
  // Fallback: normalize whitespace (handles "艾热 AIR" vs "艾热AIR")
  const normalized = normalizeAliasKey(name)
  if (Object.hasOwn(normalizedAliases, normalized)) return normalizedAliases[normalized]!
  return name
}

export function mapRawSong(raw: RawSong, options: { preserveArtistNames?: boolean } = {}): NeteaseSong {
  const invalidField = findInvalidRawSongField(raw)
  if (invalidField) {
    throw new Error(`网易云歌曲 ${raw.id} 元数据不完整：${invalidField}`)
  }
  // v3 API may put publishTime at song level or album level, or omit it
  const pubTime = raw.publishTime ?? raw.al?.publishTime ?? 0
  return {
    id: raw.id,
    name: raw.name,
    no: raw.no ?? 0,
    dt: raw.dt ?? 0,
    disc: raw.cd || '1',
    artists: (raw.ar ?? []).map(a => ({ ...a, name: options.preserveArtistNames ? a.name : applyAlias(a.name) })),
    album: {
      id: raw.al?.id ?? 0,
      name: raw.al?.name ?? '未知专辑',
      picUrl: raw.al?.picUrl ?? '',
      publishTime: pubTime,
      artist: raw.al?.artist ? { ...raw.al.artist, name: !options.preserveArtistNames && applyAliasToAlbum ? applyAlias(raw.al.artist.name) : raw.al.artist.name } : undefined,
    },
  }
}

/** Fetch a single song's detail by ID */
export async function fetchSongDetail(songId: number, cookie: string): Promise<NeteaseSong> {
  const res = await song_detail({ ids: String(songId), cookie })
  const data = (res as NeteaseResponse<SongDetailBody>).body
  if (!data?.songs?.[0]) throw new Error(`无法获取歌曲 ${songId} 的详情`)
  return mapRawSong(data.songs[0])
}

/** Cache album detail calls — they repeat across songs in the same album */
const albumCache = new Map<number, AlbumDetail>()

export async function fetchAlbumDetail(albumId: number, cookie: string): Promise<AlbumDetail | null> {
  if (albumCache.has(albumId)) return albumCache.get(albumId)!

  try {
    const res = await album({ id: albumId, cookie })
    const data = (res as { body?: { album?: RawAlbum; songs?: unknown[] } }).body
    if (!data?.album) return null

    const a = data.album
    // type-coverage:ignore-next — RawAlbum fields vary by API version
    const rawAlbum = a as Record<string, unknown>
    let tagsStr = ''
    if (typeof rawAlbum.tags === 'string') {
      tagsStr = rawAlbum.tags
    } else if (Array.isArray(rawAlbum.tags)) {
      tagsStr = (rawAlbum.tags as string[]).join(', ')
    }
    // Compute total discs from album song list
    let totalDiscs = 1
    if (Array.isArray(data.songs)) {
      const discs = data.songs
        .map((s) => parseInt((s as { cd?: string }).cd ?? '1', 10))
        .filter((n) => !isNaN(n))
      if (discs.length) totalDiscs = Math.max(...discs)
    }

    const detail: AlbumDetail = {
      name: a.name ?? '未知专辑',
      picUrl: a.picUrl ?? '',
      publishTime: a.publishTime ?? 0,
      company: a.company ?? '',
      description: (a as { description?: string }).description ?? '',
      genre: (a as { genre?: string }).genre || tagsStr || '',
      artist: a.artist?.name ?? a.artists?.[0]?.name ?? '',
      size: a.size ?? (Array.isArray(data.songs) ? data.songs.length : 0),
      subType: (a as { subType?: string }).subType ?? '',
      totalDiscs,
      type: (a as { type?: string }).type ?? '',
      artistImgUrl: a.artist?.img1v1Url ?? a.artists?.[0]?.img1v1Url ?? '',
      info: a.info,
    }

    albumCache.set(albumId, detail)
    return detail
  } catch {
    return null
  }
}

interface RawAlbum {
  name?: string
  picUrl?: string
  publishTime?: number
  company?: string
  description?: string
  genre?: string
  subType?: string
  artist?: { name?: string; img1v1Url?: string }
  artists?: Array<{ name?: string; img1v1Url?: string }>
  size?: number
  info?: { comment?: { threadId?: string } }
}

export function clearAlbumCache() {
  albumCache.clear()
}

export async function getSongUrl(
  songId: number,
  quality: string,
  cookie: string,
): Promise<{ url: string; type: string }> {
  const level = QUALITY_LEVELS[quality] || 'jymaster'

  let res = await song_url_v1({ id: songId, level: toNeteaseQualityLevel(level), cookie })
  let data = (res as { body?: { data?: { url?: string; type?: string }[] } }).body?.data?.[0]

  if (!data || (data.type !== 'flac' && data.type !== 'mp3')) {
    res = await song_url_v1({ id: songId, level: toNeteaseQualityLevel('hires'), cookie })
    data = (res as { body?: { data?: { url?: string; type?: string }[] } }).body?.data?.[0]
  }

  if (!data?.url) {
    throw new Error(`无法获取歌曲 ${songId} 的下载链接`)
  }

  return { url: data.url, type: data.type ?? 'mp3' }
}

export interface LyricData {
  original: string
  translated: string
  romaji: string
  merged: string
  separateFiles: boolean
}

export async function fetchLyric(
  songId: number,
  cookie: string,
  order: LyricOrder = 'original_first',
  includeTranslation = true,
): Promise<LyricData> {
  const res = await lyric_new({ id: songId, cookie })
  const body = (res as { body?: { lrc?: { lyric?: string }; tlyric?: { lyric?: string }; romalrc?: { lyric?: string } } }).body

  const original = body?.lrc?.lyric ?? ''
  const translated = includeTranslation ? (body?.tlyric?.lyric ?? '') : ''
  const romaji = body?.romalrc?.lyric ?? ''
  const separateFiles = order === 'separate'

  const merged = separateFiles ? original : mergeLyrics(original, translated, order)

  return { original, translated, romaji, merged, separateFiles }
}

export function mergeLyrics(
  original: string,
  translated: string,
  order: 'original_first' | 'translated_first',
): string {
  if (!translated) return original

  const origLines = original.split('\n').filter(Boolean)
  const transLines = translated.split('\n').filter(Boolean)
  if (transLines.length === 0) return original

  const transMap = new Map<string, string>()
  for (const line of transLines) {
    const m = line.match(/^(\[\d{2}:\d{2}[.\d]*\])(.*)/)
    if (m) transMap.set(m[1]!, m[2]!)
  }

  const merged: string[] = []
  for (const line of origLines) {
    const m = line.match(/^(\[\d{2}:\d{2}[.\d]*\])/)
    const timeTag = m?.[1]
    const translation = timeTag && transMap.has(timeTag) ? `${timeTag}${transMap.get(timeTag) ?? ''}` : null

    if (order === 'original_first') {
      merged.push(line)
      if (translation) merged.push(translation)
    } else {
      if (translation) merged.push(translation)
      merged.push(line)
    }
  }

  return merged.join('\n')
}

// ── User playlists ──

export interface UserPlaylist {
  id: number
  name: string
  trackCount: number
  playCount: number
  coverImgUrl: string
  creator: { nickname: string; userId: number }
  subscribed: boolean
}

export interface UserAlbum {
  id: number
  name: string
  size: number
  picUrl: string
  artist: { name: string }
  publishTime: number
  subTime: number
}

export async function fetchUserPlaylists(
  uid: number,
  cookie: string,
  limit = 100,
  offset = 0,
): Promise<UserPlaylist[]> {
  const res = await user_playlist({ uid, limit, offset, cookie })
  const body = (res as NeteaseResponse<{ playlist?: UserPlaylistResponseItem[] }>).body
  return (body?.playlist ?? []).map(p => ({
    id: p.id,
    name: p.name,
    trackCount: p.trackCount,
    playCount: p.playCount,
    coverImgUrl: p.coverImgUrl || '',
    creator: { nickname: p.creator?.nickname || '', userId: p.creator?.userId || 0 },
    subscribed: p.subscribed || false,
  }))
}

export async function fetchUserAlbums(
  cookie: string,
  _uid?: number,
  limit = 100,
  offset = 0,
): Promise<UserAlbum[]> {
  const res = await album_sublist({ limit, offset, cookie })
  const body = (res as NeteaseResponse<{ data?: UserAlbumResponseItem[] }>).body
  return (body?.data ?? []).map(a => ({
    id: a.id,
    name: a.name,
    size: a.size || 0,
    picUrl: a.picUrl || '',
    artist: { name: a.artists?.[0]?.name || a.artist?.name || '' },
    publishTime: a.publishTime || 0,
    subTime: a.subTime || 0,
  }))
}

export async function fetchAlbumSongs(
  albumId: number,
  cookie: string,
): Promise<NeteaseSong[]> {
  const res = await album({ id: albumId, cookie })
  const body = (res as NeteaseResponse<SongDetailBody>).body
  return (body?.songs ?? []).map(song => mapRawSong(song))
}

export async function fetchPlaylistName(playlistId: number): Promise<string | null> {
  try {
    const res = await fetch(`https://music.163.com/api/v1/playlist/detail?id=${playlistId}`)
    const body = (await res.json()) as { playlist?: { name?: string } }
    return body.playlist?.name ?? null
  } catch { return null }
}
