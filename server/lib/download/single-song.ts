import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import dayjs from 'dayjs'
import { fetchSongDetail, getSongUrl, fetchLyric, fetchAlbumDetail } from '../netease'
import { downloadSong, buildDownloadPath, checkAncillaryFiles } from '../tag-writer'
import type { SongOps } from '../tag-writer'
import { createSplitArtists } from '../sync/artist-utils'
import type { DownloadMode } from './types'
import { getDb } from '../db'
import { upsertLookup } from '../sync/lookup'

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
  downloadRomajiLyric: boolean
  downloadMode?: DownloadMode
  /** Override computed path — used by repair to write next to existing file. */
  audioPath?: string
}

/**
 * Download a single song from Netease with full metadata tagging.
 * Extracted from the sync service processor for reuse by single-song retry.
 *
 * @param songId - Netease song ID
 * @param config - Download configuration (mode defaults to 'full')
 * @param onProgress - Optional progress callback (0-100)
 */
export async function downloadSingleSong(
  songId: number,
  config: SingleSongConfig,
  onProgress?: (pct: number, phase?: 'downloading' | 'tagging') => void,
): Promise<{ filePath: string; fileType: string; ops: SongOps }> {
  const mode: DownloadMode = config.downloadMode ?? 'full'

  // 1. Fetch song detail
  const song = await fetchSongDetail(songId, config.cookie)

  // 2. Get download URL (always needed — fileType is required for path building)
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

  // 6. Build download path (use audioPath override if provided)
  let targetPath: string
  let relativePath: string

  if (config.audioPath) {
    targetPath = config.audioPath
    relativePath = relative(config.downloadDir, config.audioPath)
    if (relativePath.startsWith('..')) {
      // audioPath is outside downloadDir — fall back to computed path
      relativePath = buildDownloadPath(config.pathFormat, {
        artist: albumArtist,
        album: song.album.name,
        title: song.name,
        year: song.album.publishTime > 0 ? dayjs(song.album.publishTime).format('YYYY') : '',
        track: String(song.no),
        'track:02d': String(song.no).padStart(2, '0'),
      }, fileType)
      targetPath = join(config.downloadDir, relativePath)
    }
  } else {
    const pathVars = {
      artist: albumArtist,
      album: song.album.name,
      title: song.name,
      year: song.album.publishTime > 0 ? dayjs(song.album.publishTime).format('YYYY') : '',
      track: String(song.no),
      'track:02d': String(song.no).padStart(2, '0'),
    }
    relativePath = buildDownloadPath(config.pathFormat, pathVars, fileType)
    targetPath = join(config.downloadDir, relativePath)
  }
  const audioExists = existsSync(targetPath)

  // 7. Determine what to skip based on mode and file existence
  let skipAudio = false
  let skipLyrics = false
  let skipAlbumCover = false
  let skipArtistImage = false

  if (audioExists) {
    skipAudio = true // never re-download audio

    if (mode === 'missing') {
      const ancStatus = checkAncillaryFiles(targetPath, {
        writeLyrics: config.downloadLyrics,
        saveAlbumCover: config.saveAlbumCover,
        saveArtistImage: config.saveArtistImage,
        separateLyricFiles: lyricData?.separateFiles,
        hasTranslatedLyric: config.downloadTranslatedLyric && !!lyricData?.translated,
        hasRomajiLyric: config.downloadRomajiLyric && !!lyricData?.romaji,
      })
      skipLyrics = ancStatus.lyricExists
        && (!config.downloadRomajiLyric || ancStatus.romajiLyricExists)
        && (!config.downloadTranslatedLyric || ancStatus.translatedLyricExists)
      skipAlbumCover = !config.saveAlbumCover || ancStatus.coverExists
      skipArtistImage = !config.saveArtistImage || ancStatus.artistImageExists
    }
    // In 'full' mode: skip audio, but always write ancillary files (overwrite)
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

  // 9. Download + tag (pass undefined url when skipping audio)
  const result = await downloadSong(
    skipAudio ? undefined : url,
    songMeta,
    fileType,
    config.downloadDir,
    {
      writeLyrics: config.downloadLyrics && !skipLyrics,
      embedMetadata: config.embedMetadata,
      embedCover: config.embedCover,
      saveAlbumCover: config.saveAlbumCover && !skipAlbumCover,
      saveArtistImage: config.saveArtistImage && !skipArtistImage,
      lyrics: lyricData?.merged,
      translatedLyric: lyricData?.translated,
      romajiLyric: config.downloadRomajiLyric ? lyricData?.romaji : undefined,
      separateLyricFiles: lyricData?.separateFiles,
    },
    relativePath,
    onProgress,
  )

  // 10. Cache file path for future lookups
  if (result.ops.download !== 'failed') {
    try {
      upsertLookup(getDb(), songId, null, result.filePath)
    } catch { /* non-critical */ }
  }

  return { filePath: result.filePath, fileType, ops: result.ops }
}
