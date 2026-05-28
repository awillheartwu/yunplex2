import pkg from 'NeteaseCloudMusicApi'
const { login_status, song_url_v1, lyric_new, song_detail, album, user_playlist } = pkg

export interface NeteaseSong {
  id: number
  name: string
  no: number
  dt: number
  disc: string
  artists: { name: string }[]
  album: {
    id: number
    name: string
    picUrl: string
    publishTime: number
    artist?: { name: string }
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
): Promise<{ songs: NeteaseSong[]; trackUpdateTime: number | null; trackIds: { id: number }[]; playlistName: string | null }> {
  const url = `https://music.163.com/api/v1/playlist/detail?id=${playlistId}`
  const res = await fetch(url)
  const body = (await res.json()) as { playlist?: { name?: string; trackIds: { id: number }[]; trackUpdateTime?: number } }
  const allIds = body.playlist?.trackIds ?? []
  const trackUpdateTime = body.playlist?.trackUpdateTime ?? null
  const playlistName = body.playlist?.name ?? null
  const slicedIds = limit && limit > 0 ? allIds.slice(0, limit) : allIds

  if (slicedIds.length === 0) return { songs: [], trackUpdateTime, trackIds: slicedIds, playlistName }

  // Batch song_detail — API rejects too many IDs at once (safe limit: ~500)
  const BATCH_SIZE = 400
  const allSongs: NeteaseSong[] = []

  for (let offset = 0; offset < slicedIds.length; offset += BATCH_SIZE) {
    const batch = slicedIds.slice(offset, offset + BATCH_SIZE)
    const ids = batch.map((t) => String(t.id)).join(',')

    const [v3Res, oldRes] = await Promise.all([
      song_detail({ ids, cookie }),
      fetch(`http://music.163.com/api/song/detail/?id=&ids=[${ids}]`),
    ])

    const data = (v3Res as any).body as { songs?: RawSong[] } | undefined
    const oldData = await oldRes.json() as { songs?: { album?: { publishTime?: number } }[] } | undefined

    if (data?.songs) {
      for (const s of data.songs) {
        const song = mapRawSong(s)
        // Fallback: old API often has publishTime when v3 doesn't
        if (!song.album.publishTime && oldData?.songs) {
          const match = oldData.songs.find((os: any) => os?.id === s.id)
          if (match?.album?.publishTime) song.album.publishTime = match.album.publishTime
        }
        allSongs.push(song)
      }
    }
  }

  return { songs: allSongs, trackUpdateTime, trackIds: slicedIds, playlistName }
}

interface RawSong {
  id: number
  name: string
  no: number
  dt: number
  cd: string
  publishTime?: number
  ar?: { name: string }[]
  al?: {
    id: number
    name: string
    picUrl: string
    publishTime?: number
    artist?: { name: string }
  }
}

function mapRawSong(raw: RawSong): NeteaseSong {
  // v3 API may put publishTime at song level or album level, or omit it
  const pubTime = raw.publishTime ?? raw.al?.publishTime ?? 0
  return {
    id: raw.id,
    name: raw.name,
    no: raw.no ?? 0,
    dt: raw.dt ?? 0,
    disc: raw.cd || '1',
    artists: raw.ar ?? [],
    album: {
      id: raw.al?.id ?? 0,
      name: raw.al?.name ?? '未知专辑',
      picUrl: raw.al?.picUrl ?? '',
      publishTime: pubTime,
      artist: raw.al?.artist,
    },
  }
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
      artistImgUrl: (a.artist as any)?.img1v1Url ?? (Array.isArray(a.artists) ? (a.artists[0] as any)?.img1v1Url ?? '' : ''),
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
  artist?: { name?: string }
  artists?: { name?: string }[]
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

  let res = await song_url_v1({ id: songId, level: level as any, cookie })
  let data = (res as { body?: { data?: { url?: string; type?: string }[] } }).body?.data?.[0]

  if (!data || (data.type !== 'flac' && data.type !== 'mp3')) {
    res = await song_url_v1({ id: songId, level: 'hires' as any, cookie })
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
  merged: string
  separateFiles: boolean
}

export async function fetchLyric(
  songId: number,
  cookie: string,
  order: 'original_first' | 'translated_first' = 'original_first',
  includeTranslation = true,
): Promise<LyricData> {
  const res = await lyric_new({ id: songId, cookie })
  const body = (res as { body?: { lrc?: { lyric?: string }; tlyric?: { lyric?: string } } }).body

  const original = body?.lrc?.lyric ?? ''
  const translated = includeTranslation ? (body?.tlyric?.lyric ?? '') : ''
  const separateFiles = (order as string) === 'separate'

  const merged = separateFiles ? original : mergeLyrics(original, translated, order)

  return { original, translated, merged, separateFiles }
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

export async function fetchUserPlaylists(
  uid: number,
  cookie: string,
  limit = 100,
  offset = 0,
): Promise<UserPlaylist[]> {
  const res = await user_playlist({ uid, limit, offset, cookie })
  const body = (res as any).body as { playlist?: any[] }
  return (body.playlist || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    trackCount: p.trackCount,
    playCount: p.playCount,
    coverImgUrl: p.coverImgUrl || '',
    creator: { nickname: p.creator?.nickname || '', userId: p.creator?.userId || 0 },
    subscribed: p.subscribed || false,
  }))
}

export async function fetchPlaylistName(playlistId: number): Promise<string | null> {
  try {
    const res = await fetch(`https://music.163.com/api/v1/playlist/detail?id=${playlistId}`)
    const body = (await res.json()) as { playlist?: { name?: string } }
    return body.playlist?.name ?? null
  } catch { return null }
}
