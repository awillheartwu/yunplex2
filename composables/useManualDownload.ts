/**
 * Manual download workspace composable.
 *
 * State machine: idle → parsing → preview
 * Handles URL/ID auto-detection, metadata fetching,
 * track selection, and download triggering.
 */

export interface ParsedTrack {
  id: number
  name: string
  no: number
  dt: number
  disc: string
  artists: { name: string }[]
  album: { id: number; name: string; picUrl: string }
  selected: boolean
}

export type ParseState = 'idle' | 'parsing' | 'preview'
export type ResourceType = 'playlist' | 'album' | 'songs'

interface PlaylistSongsResponse {
  songs: ParsedTrack[]
  trackUpdateTime: number | null
  trackIds: { id: number }[]
  playlistName: string | null
}

interface AlbumSongsResponse {
  songs: ParsedTrack[]
  album: {
    name: string
    picUrl: string
    publishTime: number
    company: string
    description: string
    artist: string
    size: number
    artistImgUrl: string
    subType: string
    type: string
  } | null
}

export const URL_PATTERNS: { pattern: RegExp; type: ResourceType }[] = [
  { pattern: /music\.163\.com\/playlist\?id=(\d+)/i, type: 'playlist' },
  { pattern: /music\.163\.com\/album\?id=(\d+)/i, type: 'album' },
  { pattern: /music\.163\.com\/song\?id=(\d+)/i, type: 'songs' },
  { pattern: /music\.163\.com\/#\/playlist\?id=(\d+)/i, type: 'playlist' },
  { pattern: /music\.163\.com\/#\/album\?id=(\d+)/i, type: 'album' },
  { pattern: /music\.163\.com\/#\/song\?id=(\d+)/i, type: 'songs' },
]

export function useManualDownload() {
  const api = useApi()

  // ── State machine ──
  const parseState = ref<ParseState>('idle')
  const inputValue = ref('')
  const resourceType = ref<ResourceType | null>(null)
  const detectHint = ref('') // Human-readable detection note, e.g. "已识别为歌单"

  // ── Parsed metadata ──
  const title = ref('')
  const artist = ref('')
  const coverUrl = ref('')
  const tracks = ref<ParsedTrack[]>([])
  const neteaseId = ref<number | null>(null)
  const trackCount = ref(0)
  const albumInfo = ref<AlbumSongsResponse['album'] | null>(null)

  // ── Download options ──
  const quality = ref('jymaster')
  const downloadLyrics = ref(true)
  const downloadImages = ref(true)
  const embedMetadata = ref(true)

  // ── Messages ──
  const error = ref('')
  const saveError = ref('')
  const downloadResult = ref<{ batchId: string; total: number } | null>(null)
  const downloading = ref(false)

  // ── Computed ──
  const allSelected = computed(() =>
    tracks.value.length > 0 && tracks.value.every((t) => t.selected),
  )
  const selectedCount = computed(() => tracks.value.filter((t) => t.selected).length)

  // ═══ Auto-detect logic ═══

  /**
   * Try to match input against URL patterns.
   */
  function matchUrl(text: string): { type: ResourceType; id: number } | null {
    const trimmed = text.trim()
    for (const { pattern, type } of URL_PATTERNS) {
      const m = trimmed.match(pattern)
      if (m && m[1]) {
        return { type, id: parseInt(m[1]!, 10) }
      }
    }
    return null
  }

  /**
   * True if the input contains multiple lines with numeric content.
   */
  function isMultiLine(text: string): boolean {
    const lines = text
      .trim()
      .split(/[\n,;]+/)
      .map((l) => l.trim())
      .filter(Boolean)
    return lines.length > 1 && lines.every((l) => /^\d+$/.test(l))
  }

  function parseMultiLineIds(text: string): number[] {
    return text
      .trim()
      .split(/[\n,;]+/)
      .map((l) => l.trim())
      .filter((l) => /^\d+$/.test(l))
      .map(Number)
  }

  // ═══ Fetch helpers ═══

  async function fetchPlaylist(id: number) {
    const data = await api.get<PlaylistSongsResponse>('/netease/playlist-songs', { id: String(id) })
    resourceType.value = 'playlist'
    detectHint.value = '已识别为歌单'
    neteaseId.value = id
    title.value = data.playlistName || `歌单 ${id}`
    coverUrl.value = data.songs[0]?.album.picUrl || ''
    trackCount.value = data.songs.length
    tracks.value = data.songs.map((s) => ({ ...s, selected: true }))
    // Use first song's artist as overall artist display
    const firstArtist = data.songs[0]?.artists?.[0]?.name
    artist.value = firstArtist || ''
  }

  async function fetchAlbum(id: number) {
    const data = await api.get<AlbumSongsResponse>('/netease/album-songs', { id: String(id) })
    resourceType.value = 'album'
    detectHint.value = '已识别为专辑'
    neteaseId.value = id
    title.value = data.album?.name || `专辑 ${id}`
    artist.value = data.album?.artist || ''
    coverUrl.value = data.album?.picUrl || data.songs[0]?.album.picUrl || ''
    trackCount.value = data.songs.length
    albumInfo.value = data.album
    tracks.value = data.songs.map((s) => ({ ...s, selected: true }))
  }

  async function fetchSong(id: number) {
    const data = await api.get<ParsedTrack>('/netease/song-detail', { id: String(id) })
    resourceType.value = 'songs'
    detectHint.value = '已识别为单曲'
    neteaseId.value = id
    title.value = data.name
    artist.value = data.artists.map((a) => a.name).join(' / ')
    coverUrl.value = data.album.picUrl || ''
    trackCount.value = 1
    tracks.value = [{ ...data, selected: true }]
  }

  async function fetchSongsByIds(ids: number[]) {
    // Fetch each song individually
    resourceType.value = 'songs'
    detectHint.value = `已识别为 ${ids.length} 首歌曲`
    neteaseId.value = null
    title.value = `手动输入 · ${ids.length} 首`
    artist.value = ''
    coverUrl.value = ''
    trackCount.value = ids.length

    const results: ParsedTrack[] = []
    for (const id of ids) {
      try {
        const song = await api.get<ParsedTrack>('/netease/song-detail', { id: String(id) })
        results.push({ ...song, selected: true })
        if (!coverUrl.value) coverUrl.value = song.album.picUrl || ''
      } catch {
        // Skip individual failures
      }
    }
    tracks.value = results
    if (results.length > 0 && results[0]) {
      const a = results[0].artists.map((ar) => ar.name).join(' / ')
      if (a) artist.value = a
    }
  }

  // ═══ Main parse function ═══

  async function parse() {
    const text = inputValue.value.trim()
    if (!text) {
      error.value = '请输入网易云链接或 ID'
      return
    }

    parseState.value = 'parsing'
    error.value = ''
    saveError.value = ''
    downloadResult.value = null

    try {
      // 1. URL pattern match
      const urlMatch = matchUrl(text)
      if (urlMatch) {
        if (urlMatch.type === 'playlist') {
          await fetchPlaylist(urlMatch.id)
        } else if (urlMatch.type === 'album') {
          await fetchAlbum(urlMatch.id)
        } else {
          await fetchSong(urlMatch.id)
        }
        parseState.value = 'preview'
        return
      }

      // 2. Multi-line → song IDs
      if (isMultiLine(text)) {
        const ids = parseMultiLineIds(text)
        if (ids.length === 0) {
          error.value = '未识别到有效的歌曲 ID'
          parseState.value = 'idle'
          return
        }
        await fetchSongsByIds(ids)
        parseState.value = 'preview'
        return
      }

      // 3. Single number → try chain: song → album → playlist
      const numId = parseInt(text, 10)
      if (!isNaN(numId)) {
        // Try song first
        try {
          await fetchSong(numId)
          parseState.value = 'preview'
          return
        } catch {
          // Not a song, try album
        }

        try {
          await fetchAlbum(numId)
          parseState.value = 'preview'
          return
        } catch {
          // Not an album, try playlist
        }

        try {
          await fetchPlaylist(numId)
          parseState.value = 'preview'
          return
        } catch {
          // All failed
        }

        error.value = `无法将 "${text}" 识别为歌单、专辑或单曲 ID`
        parseState.value = 'idle'
        return
      }

      error.value = `无法识别输入内容："${text}"`
      parseState.value = 'idle'
    } catch (err) {
      error.value = err instanceof Error ? err.message : '解析失败，请检查输入'
      parseState.value = 'idle'
    }
  }

  // ═══ Download ═══

  async function download(): Promise<{ batchId: string; total: number } | null> {
    if (selectedCount.value === 0) {
      error.value = '请至少选择一首歌曲'
      return null
    }

    downloading.value = true
    error.value = ''

    try {
      const selectedIds = tracks.value.filter((t) => t.selected).map((t) => t.id)

      let payload: {
        type: ResourceType
        neteaseId?: number
        songIds?: number[]
        quality?: string
        downloadLyrics?: boolean
        downloadImages?: boolean
        embedMetadata?: boolean
      }

      const base = {
        quality: quality.value,
        downloadLyrics: downloadLyrics.value,
        downloadImages: downloadImages.value,
        embedMetadata: embedMetadata.value,
      }

      if (resourceType.value === 'songs') {
        payload = {
          type: 'songs',
          songIds: selectedIds,
          ...base,
        }
      } else {
        payload = {
          type: resourceType.value!,
          neteaseId: neteaseId.value!,
          ...base,
        }
      }

      const result = await api.post<{ batchId: string; total: number }>('/download', payload)
      downloadResult.value = result
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : '启动下载失败'
      return null
    } finally {
      downloading.value = false
    }
  }

  async function downloadAndSave(): Promise<{ batchId: string; total: number; savedAsSource?: boolean; saveError?: string } | null> {
    const result = await download()
    if (!result) return null

    // Save as sync source via dedicated bridge endpoint
    if (resourceType.value && neteaseId.value && resourceType.value !== 'songs') {
      try {
        await api.post('/manual-download/save-as-source', {
          neteaseId: neteaseId.value,
          type: resourceType.value,
          trackCount: trackCount.value,
          name: title.value || undefined,
          artist: artist.value || undefined,
        })
        return { ...result, savedAsSource: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '保存同步源失败'
        // Surface error to UI — download succeeded but save failed
        saveError.value = msg
        return { ...result, saveError: msg }
      }
    }

    return result
  }

  // ═══ Track selection ═══

  function toggleAll() {
    const select = !allSelected.value
    for (const t of tracks.value) {
      t.selected = select
    }
  }

  function toggleTrack(id: number) {
    const track = tracks.value.find((t) => t.id === id)
    if (track) track.selected = !track.selected
  }

  function reset() {
    parseState.value = 'idle'
    resourceType.value = null
    detectHint.value = ''
    title.value = ''
    artist.value = ''
    coverUrl.value = ''
    tracks.value = []
    neteaseId.value = null
    trackCount.value = 0
    albumInfo.value = null
    error.value = ''
    saveError.value = ''
    downloadResult.value = null
    downloading.value = false
  }

  return {
    // State
    parseState,
    inputValue,
    resourceType,
    detectHint,
    // Parsed data
    title,
    artist,
    coverUrl,
    tracks,
    neteaseId,
    trackCount,
    albumInfo,
    // Options
    quality,
    downloadLyrics,
    downloadImages,
    embedMetadata,
    // plexEnabled intentionally not exposed — one-shot downloads are Plex-independent; bridge via "save as sync source"
    // Messages
    error,
    saveError,
    downloadResult,
    downloading,
    // Computed
    allSelected,
    selectedCount,
    // Actions
    parse,
    download,
    downloadAndSave,
    toggleAll,
    toggleTrack,
    reset,
  }
}
