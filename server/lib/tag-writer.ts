import { existsSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { Worker } from 'node:worker_threads'
import dayjs from 'dayjs'
import type { SongTask } from './job/types'

export interface SongMeta {
  title: string
  albumArtist: string
  trackArtist: string
  album: string
  trackNumber: number
  publishTime: number
  picUrl: string
  duration: number
  discNumber: string
  totalDiscs: number
  totalTracks: number
  genre: string
  releaseDate: string
  albumDescription: string
  recordLabel: string
  releaseType: string
  artistImgUrl: string
}


export type SongOps = NonNullable<SongTask['ops']>

export interface DownloadResult {
  filePath: string
  ops: SongOps
}

const FLAC_TAG_TIMEOUT_MS = 120000

export function buildDownloadPath(
  pathFormat: string,
  vars: Record<string, string>,
  ext: string,
): string {
  let rel = pathFormat
  for (const [key, value] of Object.entries(vars)) {
    rel = rel.replace(new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), value)
  }
  // Clean empty placeholders like " ()" or double spaces
  rel = rel.replace(/\s*\(\s*\)/g, '').replace(/\s+/g, ' ').trim()
  // Sanitize each path segment
  const segments = rel.split('/').map(sanitizePath).filter(Boolean)
  const fileName = segments.pop()!
  return join(...segments, `${fileName}.${ext}`)
}

export interface AncillaryFileStatus {
  lyricExists: boolean
  translatedLyricExists: boolean
  romajiLyricExists: boolean
  coverExists: boolean
  artistImageExists: boolean
}

/** Check which ancillary files exist on disk for a given audio file path. */
export function checkAncillaryFiles(
  filePath: string,
  opts: {
    writeLyrics: boolean
    saveAlbumCover: boolean
    saveArtistImage: boolean
    separateLyricFiles?: boolean
    hasTranslatedLyric?: boolean
    hasRomajiLyric?: boolean
  },
): AncillaryFileStatus {
  const lyricBase = filePath.replace(/\.\w+$/, '')
  const status: AncillaryFileStatus = {
    lyricExists: false,
    translatedLyricExists: false,
    romajiLyricExists: false,
    coverExists: false,
    artistImageExists: false,
  }
  if (!opts.writeLyrics) return status

  const separate = opts.separateLyricFiles && opts.hasTranslatedLyric
  if (separate) {
    status.lyricExists = existsSync(lyricBase + ' (orgi).lrc')
    status.translatedLyricExists = existsSync(lyricBase + ' (trans).lrc')
  } else {
    status.lyricExists = existsSync(lyricBase + '.lrc')
    // In merged mode, translations are in the same .lrc file
    status.translatedLyricExists = opts.hasTranslatedLyric ? status.lyricExists : true
  }
  if (opts.hasRomajiLyric) {
    status.romajiLyricExists = existsSync(lyricBase + ' (romaji).lrc')
  } else {
    status.romajiLyricExists = true // nothing to write — "exists"
  }
  const albumPath = dirname(filePath)
  if (opts.saveAlbumCover) {
    status.coverExists = existsSync(join(albumPath, 'cover.jpg'))
  }
  if (opts.saveArtistImage) {
    status.artistImageExists = existsSync(join(dirname(albumPath), 'artist.jpg'))
  }
  return status
}

export async function downloadSong(
  url: string | undefined,
  meta: SongMeta,
  fileType: string,
  downloadDir: string,
  options: {
    writeLyrics: boolean
    embedMetadata: boolean
    embedCover: boolean
    saveAlbumCover: boolean
    saveArtistImage: boolean
    lyrics?: string
    translatedLyric?: string
    romajiLyric?: string
    separateLyricFiles?: boolean
  },
  relativePath: string,
  onProgress?: (pct: number, phase?: 'downloading' | 'tagging') => void,
): Promise<DownloadResult> {
  const ops: SongOps = {
    download: url ? 'ok' : 'skipped',
    lyric: 'skipped',
    tags: 'skipped',
    cover: 'skipped',
  }

  const albumPath = join(downloadDir, dirname(relativePath))
  if (!existsSync(albumPath)) {
    await mkdir(albumPath, { recursive: true })
  }

  const filePath = join(downloadDir, relativePath)

  // Download audio file with streaming progress (skipped if url is undefined)
  if (url) {
    try {
      const songRes = await fetch(url)
      const contentLength = parseInt(songRes.headers.get('content-length') || '0', 10)
      const reader = songRes.body?.getReader()
      if (!reader) throw new Error('No response body')

      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        if (contentLength > 0 && onProgress) {
          onProgress(Math.round(received / contentLength * 100), 'downloading')
        }
      }
      const buffer = Buffer.concat(chunks)
      await writeFile(filePath, buffer)
      ops.download = 'ok'
    } catch {
      ops.download = 'failed'
      return { filePath, ops }
    }
  }

  // Download lyrics — derive path from audio file path
  if (options.writeLyrics) {
    try {
      if (options.lyrics) {
        const lyricBase = filePath.replace(/\.\w+$/, '')
        if (options.separateLyricFiles && options.translatedLyric) {
          await writeFile(lyricBase + ' (orgi).lrc', options.lyrics, 'utf-8')
          await writeFile(lyricBase + ' (trans).lrc', options.translatedLyric, 'utf-8')
        } else {
          await writeFile(lyricBase + '.lrc', options.lyrics, 'utf-8')
        }
        if (options.romajiLyric) {
          await writeFile(lyricBase + ' (romaji).lrc', options.romajiLyric, 'utf-8')
        }
        ops.lyric = 'ok'
      } else {
        ops.lyric = 'failed'
      }
    } catch {
      ops.lyric = 'failed'
    }
  }

  // Download cover once for embed + save
  let imageBuffer: Buffer | null = null
  if (options.embedCover || options.saveAlbumCover) {
    imageBuffer = await downloadImage(meta.picUrl)
  }

  if (options.embedMetadata) {
    try {
      // Report tagging phase start so UI shows "写标签" immediately
      onProgress?.(0, 'tagging')

      if (fileType === 'flac') {
        await writeFlacTags(filePath, meta, imageBuffer)
      } else {
        await writeMp3Tags(filePath, meta, imageBuffer)
      }
      ops.tags = 'ok'

      if (options.embedCover && imageBuffer) {
        ops.cover = 'ok'
      } else if (options.embedCover && !imageBuffer) {
        ops.cover = 'failed'
      }

      onProgress?.(100, 'tagging')
    } catch (err) {
      console.error(`[YunPlex2] 标签写入失败: ${filePath}`, err)
      ops.tags = 'failed'
      ops.cover = 'failed'
      onProgress?.(100, 'tagging')
    }
  }

  // Save standalone cover images
  const artistPath = dirname(albumPath)
  if (options.saveAlbumCover) {
    try {
      const coverBuf = imageBuffer ?? await downloadImage(meta.picUrl)
      if (coverBuf) await writeFile(join(albumPath, 'cover.jpg'), coverBuf)
    } catch { /* non-critical */ }
  }
  if (options.saveArtistImage && meta.artistImgUrl) {
    const artistImgPath = join(artistPath, 'artist.jpg')
    if (!existsSync(artistImgPath)) {
      try {
        const artistImg = await downloadImage(meta.artistImgUrl)
        if (artistImg) await writeFile(artistImgPath, artistImg)
      } catch { /* non-critical */ }
    }
  }

  return { filePath, ops }
}

async function downloadImage(picUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(picUrl)
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

export function buildFlacTagMap(meta: SongMeta): Record<string, string> {
  const hasDate = meta.publishTime > 0
  const tags: Record<string, string> = {
    TITLE: meta.title,
    ALBUMARTIST: meta.albumArtist,
    ALBUM: meta.album,
    TRACKNUMBER: String(meta.trackNumber),
  }
  if (hasDate) {
    tags.YEAR = dayjs(meta.publishTime).format('YYYY')
    tags.DATE = meta.releaseDate || dayjs(meta.publishTime).format('YYYY-MM-DD')
  }

  tags.ARTIST = meta.trackArtist || meta.albumArtist
  if (meta.duration) {
    const totalSec = Math.round(meta.duration / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = String(totalSec % 60).padStart(2, '0')
    tags.LENGTH = `${min}:${sec}`
  }
  if (meta.discNumber) {
    tags.DISCNUMBER = meta.totalDiscs > 1
      ? `${meta.discNumber}/${meta.totalDiscs}`
      : meta.discNumber
    if (meta.totalDiscs > 1) tags.DISCTOTAL = String(meta.totalDiscs)
  }
  if (meta.totalTracks) tags.TOTALTRACKS = String(meta.totalTracks)
  if (meta.genre) tags.GENRE = meta.genre
  if (meta.albumDescription) tags.DESCRIPTION = meta.albumDescription
  if (meta.recordLabel) tags.PUBLISHER = meta.recordLabel
  if (meta.releaseType) tags.RELEASETYPE = meta.releaseType

  return tags
}

export async function writeFlacTags(
  filePath: string,
  meta: SongMeta,
  imageBuffer: Buffer | null,
): Promise<void> {
  const tagMap = buildFlacTagMap(meta)
  await runFlacTagWorkerInline({ filePath, tagMap, imageBuffer })
}

export async function writeMp3Tags(
  filePath: string,
  meta: SongMeta,
  imageBuffer: Buffer | null,
): Promise<void> {
  const hasDate = meta.publishTime > 0
  const tags: NodeID3.Tags = {
    title: meta.title,
    albumArtist: meta.albumArtist,
    artist: meta.trackArtist || meta.albumArtist,
    album: meta.album,
    trackNumber: meta.totalTracks
      ? `${meta.trackNumber}/${meta.totalTracks}`
      : String(meta.trackNumber),
  }
  if (hasDate) {
    tags.year = dayjs(meta.publishTime).format('YYYY')
    tags.date = meta.releaseDate || dayjs(meta.publishTime).format('YYYY-MM-DD')
  }

  if (meta.duration) {
    const totalSec = Math.round(meta.duration / 1000)
    tags.length = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
  }

  // Disc info as partOfSet (e.g. "1/2" or "1")
  if (meta.discNumber) {
    tags.partOfSet = meta.totalDiscs > 1
      ? `${meta.discNumber}/${meta.totalDiscs}`
      : meta.discNumber
  }

  if (meta.genre) tags.genre = meta.genre

  // Album description + label + release type as comment
  const commentParts = [
    meta.releaseType ? `Type: ${meta.releaseType}` : '',
    meta.albumDescription,
    meta.recordLabel ? `Label: ${meta.recordLabel}` : '',
  ].filter(Boolean)
  if (commentParts.length) {
    tags.comment = { language: 'zho', text: commentParts.join(' | ') }
  }

  if (imageBuffer) {
    tags.image = {
      mime: 'jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'cover',
      imageBuffer,
    }
  }

  // Offload MP3 tag writing to a worker thread — node-id3 uses
  // readFileSync / writeFileSync internally which blocks the event loop.
  await runMp3TagWorkerInline({
    filePath,
    tags: tags as unknown as Record<string, unknown>,
    imageBuffer,
  })
}

function runWorkerWithTimeout(
  workerCode: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: payload,
    })

    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(new Error(`${label} 超时（>${Math.floor(FLAC_TAG_TIMEOUT_MS / 1000)}s）`))
    }, FLAC_TAG_TIMEOUT_MS)

    const finish = (handler: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      handler()
    }

    worker.once('message', (msg: { ok?: boolean; error?: string }) => {
      finish(() => {
        if (msg?.ok) resolve()
        else reject(new Error(msg?.error || `${label} 失败`))
      })
    })

    worker.once('error', (err) => {
      finish(() => reject(err))
    })

    worker.once('exit', (code) => {
      if (settled) return
      finish(() => {
        if (code === 0) resolve()
        else reject(new Error(`${label} worker 异常退出（code=${code}）`))
      })
    })
  })
}

function runFlacTagWorkerInline(payload: {
  filePath: string
  tagMap: Record<string, string>
  imageBuffer: Buffer | null
}): Promise<void> {
  const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    const Metaflac = require('metaflac-js');
    const MAX_PICTURE_SIZE = 16777215;

    try {
      const { filePath, tagMap, imageBuffer } = workerData;
      const flac = new Metaflac(filePath);

      for (const [key, value] of Object.entries(tagMap)) {
        flac.setTag(key + '=' + value);
      }

      if (imageBuffer && imageBuffer.byteLength <= MAX_PICTURE_SIZE) {
        flac.importPictureFromBuffer(Buffer.from(imageBuffer));
      }

      flac.save();
      parentPort.postMessage({ ok: true });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : 'FLAC tag write failed',
      });
    }
  `

  return runWorkerWithTimeout(workerCode, payload as Record<string, unknown>, 'FLAC 标签写入')
}

function runMp3TagWorkerInline(payload: {
  filePath: string
  tags: Record<string, unknown>
  imageBuffer: Buffer | null
}): Promise<void> {
  const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    const NodeID3 = require('node-id3');

    try {
      const { filePath, tags, imageBuffer } = workerData;
      // Restore image buffer (structured clone turns Buffer into Uint8Array)
      if (tags.image && imageBuffer) {
        tags.image.imageBuffer = Buffer.from(imageBuffer);
      }
      await NodeID3.Promise.write(tags, filePath);
      parentPort.postMessage({ ok: true });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : 'MP3 tag write failed',
      });
    }
  `

  return runWorkerWithTimeout(workerCode, payload as Record<string, unknown>, 'MP3 标签写入')
}

const FILENAME_REPLACE: [RegExp, string][] = [
  [/[/]/g, '／'],
  [/[\\]/g, '＼'],
  [/[:]/g, '：'],
  [/[*]/g, '＊'],
  [/[?]/g, '？'],
  [/["]/g, '＂'],
  [/[<]/g, '＜'],
  [/[>]/g, '＞'],
  [/[|]/g, '｜'],
  [/[`]/g, '｀'],
  [/\$/g, '＄'],
]

export function sanitizePath(name: string): string {
  let result = name.trim()
  for (const [re, replacement] of FILENAME_REPLACE) {
    result = result.replace(re, replacement)
  }
  // Remove leading/trailing dots and spaces (Windows restriction)
  result = result.replace(/^[. ]+/, '').replace(/[. ]+$/, '')
  return result || '_'
}
