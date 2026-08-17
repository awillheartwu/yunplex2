import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import dayjs from 'dayjs'
import { fetchSongDetail, getSongUrl, fetchLyric, fetchAlbumDetail } from '../netease'
import { downloadSong, buildDownloadPath, checkAncillaryFiles } from '../tag-writer'
import type { SongOps } from '../tag-writer'
import { validateLocalAudioFile } from '../media-validation'
import { createSplitArtists } from '../sync/artist-utils'
import type { DownloadMode } from './types'
import type { LyricOrder, MultiArtistFormat } from '../config/types'
import { getLocalMediaAsset, upsertLocalMediaAsset } from '../sync/local-media-store'
import { plexPathsExactlyEqual } from '../sync/identity-normalization'

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
  lyricOrder: LyricOrder
  downloadTranslatedLyric: boolean
  downloadRomajiLyric: boolean
  downloadMode?: DownloadMode
  /** Override computed path — used by repair to write next to existing file. */
  audioPath?: string
  /** Existing external media that must never be overwritten. */
  protectedAudioPath?: string
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
  signal?: AbortSignal,
): Promise<{
  filePath: string
  fileType: string
  ops: SongOps
  audioOperation: 'downloaded' | 'redownloaded' | 'reused'
}> {
  const mode: DownloadMode = config.downloadMode ?? 'full'

  // 1. Fetch song detail
  const song = await fetchSongDetail(songId, config.cookie)
  signal?.throwIfAborted()

  const existingAudioPath = config.audioPath
    && !relative(config.downloadDir, config.audioPath).startsWith('..')
    && existsSync(config.audioPath)
    ? config.audioPath
    : null
  const existingAudioIsValid = !existingAudioPath || validateLocalAudioFile(existingAudioPath).valid

  let url: string | undefined
  let fileType = existingAudioPath ? inferFileTypeFromPath(existingAudioPath) : ''
  if (mode === 'replace' || !fileType || !existingAudioIsValid) {
    const songUrl = await getSongUrl(song.id, config.quality, config.cookie)
    signal?.throwIfAborted()
    url = songUrl.url
    fileType = songUrl.type
  }

  // 2. Fetch lyrics (if enabled)
  const lyricData = config.downloadLyrics
    ? await fetchLyric(song.id, config.cookie, config.lyricOrder, config.downloadTranslatedLyric)
    : undefined
  signal?.throwIfAborted()

  // 3. Fetch album detail for richer metadata
  const albumDetail = await fetchAlbumDetail(song.album.id, config.cookie)
  signal?.throwIfAborted()

  // 4. Parse artists
  const splitArtists = createSplitArtists(config.multiArtistFormat as MultiArtistFormat)
  const [albumArtist, trackArtist] = splitArtists(song.artists)

  // 5. Build download path (use audioPath override if provided)
  let targetPath: string
  let relativePath: string

  const shouldReuseAudioPath = Boolean(config.audioPath)
    && (
      mode === 'replace'
        ? inferFileTypeFromPath(config.audioPath!) === fileType
        : (!existingAudioPath || existingAudioIsValid || inferFileTypeFromPath(config.audioPath!) === fileType)
    )

  if (shouldReuseAudioPath && config.audioPath) {
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
  if (
    config.protectedAudioPath
    && plexPathsExactlyEqual(targetPath, config.protectedAudioPath)
  ) {
    const extension = extname(targetPath)
    const protectedName = `${basename(targetPath, extension)} (YunPlex)${extension}`
    targetPath = join(dirname(targetPath), protectedName)
    relativePath = relative(config.downloadDir, targetPath)
  }
  const audioExists = existsSync(targetPath) && validateLocalAudioFile(targetPath).valid

  // 6. Determine what to skip based on mode and file existence
  let skipAudio = false
  let skipLyrics = false
  let skipAlbumCover = false
  let skipArtistImage = false

  if (audioExists && mode !== 'replace') {
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

  // 7. Build metadata
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

  // 8. Download + tag (pass undefined url when skipping audio)
  const downloadArgs = [
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
  ] as const
  const result = signal
    ? await downloadSong(...downloadArgs, signal)
    : await downloadSong(...downloadArgs)

  // 9. Persist the local media identity; lookup caches are not identity.
  if (result.ops.download !== 'failed') {
    try {
      const previous = getLocalMediaAsset(songId)
      const audioDownloaded = result.ops.download === 'ok'
      upsertLocalMediaAsset({
        neteaseSongId: songId,
        filePath: result.filePath,
        provenance: audioDownloaded ? 'manual' : previous?.provenance ?? 'manual',
        ownership: audioDownloaded ? 'managed' : previous?.ownership ?? 'external',
        sourceTaskId: previous?.sourceTaskId,
        evidence: {
          ...previous?.evidence,
          source: 'single_song',
          audioOperation: audioDownloaded
            ? mode === 'replace' ? 'redownloaded' : 'downloaded'
            : 'reused',
        },
      })
    } catch { /* non-critical */ }
  }

  return {
    filePath: result.filePath,
    fileType,
    ops: result.ops,
    audioOperation: result.ops.download === 'ok'
      ? mode === 'replace' ? 'redownloaded' : 'downloaded'
      : 'reused',
  }
}

function inferFileTypeFromPath(filePath: string): string {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase()
  if (ext === 'flac' || ext === 'mp3') return ext
  return ''
}
