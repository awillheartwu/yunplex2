import { existsSync } from 'node:fs'
import { join } from 'node:path'
import dayjs from 'dayjs'
import { fetchSongDetail, getSongUrl, fetchLyric, fetchAlbumDetail } from '../netease'
import { downloadSong, buildDownloadPath } from '../tag-writer'
import type { SongOps } from '../tag-writer'
import { createSplitArtists } from '../sync/artist-utils'

export interface SingleSongConfig {
  quality: string
  cookie: string
  downloadDir: string
  pathFormat: string
  multiArtistFormat: string
  downloadLyrics: boolean
  embedMetadata: boolean
  embedCover: boolean
  saveAlbumCover: boolean
  saveArtistImage: boolean
  lyricOrder: 'original_first' | 'translated_first'
  downloadTranslatedLyric: boolean
}

/**
 * Download a single song from Netease with full metadata tagging.
 * Extracted from the sync service processor for reuse by single-song retry.
 */
export async function downloadSingleSong(
  songId: number,
  config: SingleSongConfig,
  onProgress?: (pct: number) => void,
): Promise<{ filePath: string; fileType: string; ops: SongOps }> {
  // 1. Fetch song detail
  const song = await fetchSongDetail(songId, config.cookie)

  // 2. Get download URL
  const { url, type: fileType } = await getSongUrl(song.id, config.quality, config.cookie)

  // 3. Fetch lyrics (if enabled)
  const lyricData = config.downloadLyrics
    ? await fetchLyric(song.id, config.cookie, config.lyricOrder, config.downloadTranslatedLyric)
    : undefined

  // 4. Fetch album detail for richer metadata
  const albumDetail = await fetchAlbumDetail(song.album.id, config.cookie)

  // 5. Parse artists
  const splitArtists = createSplitArtists(config.multiArtistFormat)
  const [albumArtist, trackArtist] = splitArtists(song.artists)

  // 6. Build download path
  const pathVars = {
    artist: albumArtist,
    album: song.album.name,
    title: song.name,
    year: song.album.publishTime > 0 ? dayjs(song.album.publishTime).format('YYYY') : '',
    track: String(song.no),
    'track:02d': String(song.no).padStart(2, '0'),
  }
  const relativePath = buildDownloadPath(config.pathFormat, pathVars, fileType)
  const targetPath = join(config.downloadDir, relativePath)

  // 7. Skip if already on disk
  if (existsSync(targetPath)) {
    return { filePath: targetPath, fileType, ops: { download: 'ok', lyric: 'skipped', tags: 'skipped', cover: 'skipped' } }
  }

  // 8. Build metadata
  const songMeta = {
    title: song.name,
    albumArtist,
    trackArtist,
    album: song.album.name,
    trackNumber: song.no,
    publishTime: song.album.publishTime || albumDetail?.publishTime || 0,
    picUrl: song.album.picUrl,
    duration: song.dt,
    discNumber: song.disc || '1',
    totalDiscs: albumDetail?.totalDiscs ?? 1,
    totalTracks: albumDetail?.size ?? 0,
    genre: albumDetail?.genre ?? '',
    releaseDate: (song.album.publishTime || albumDetail?.publishTime || 0) > 0
      ? dayjs(song.album.publishTime || albumDetail?.publishTime).format('YYYY-MM-DD')
      : '',
    albumDescription: albumDetail?.description ?? '',
    recordLabel: albumDetail?.company ?? '',
    releaseType: albumDetail?.type ?? '',
    artistImgUrl: albumDetail?.artistImgUrl ?? '',
  }

  // 9. Download + tag
  const result = await downloadSong(url, songMeta, fileType, config.downloadDir, {
    writeLyrics: config.downloadLyrics,
    embedMetadata: config.embedMetadata,
    embedCover: config.embedCover,
    saveAlbumCover: config.saveAlbumCover,
    saveArtistImage: config.saveArtistImage,
    lyrics: lyricData?.merged,
    translatedLyric: lyricData?.translated,
    separateLyricFiles: lyricData?.separateFiles,
  }, relativePath, onProgress)

  return { filePath: result.filePath, fileType, ops: result.ops }
}
