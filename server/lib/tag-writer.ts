import { existsSync, renameSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import dayjs from 'dayjs'
import type { SongTask } from './job/types'
import type { Tags as NodeId3Tags } from 'node-id3'
import { downloadAudioToFile } from './download/audio-stream'
import { validateLocalAudioFile } from './media-validation'
import { runFlacTagWorkerInline, runMp3TagWorkerInline } from './tag-writer-worker'
import { prepareAudioCache, type DownloadAudioCache } from './download/audio-cache'

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

export class TagWriteError extends Error {
  filePath: string
  fileType: string
  ops: SongOps

  constructor(input: { filePath: string; fileType: string; ops: SongOps; detail: string; cause?: unknown }) {
    super(`标签写入失败: ${input.detail}`, { cause: input.cause })
    this.name = 'TagWriteError'
    this.filePath = input.filePath
    this.fileType = input.fileType
    this.ops = input.ops
  }
}

export function isTagWriteError(error: unknown): error is TagWriteError {
  return error instanceof TagWriteError
}

const IMAGE_DOWNLOAD_TIMEOUT_MS = 30000
const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const FILE_WRITE_RETRY_CODES = new Set(['EAGAIN', 'EBUSY', 'EMFILE'])
const FILE_WRITE_RETRY_DELAYS_MS = [80, 200, 500]

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function writeFileWithRetry(
  filePath: string,
  data: Parameters<typeof writeFile>[1],
  options?: Parameters<typeof writeFile>[2],
): Promise<void> {
  let lastError: unknown

  for (let attempt = 0; attempt <= FILE_WRITE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await writeFile(filePath, data as never, options as never)
      return
    } catch (error) {
      lastError = error
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
      if (!FILE_WRITE_RETRY_CODES.has(code) || attempt === FILE_WRITE_RETRY_DELAYS_MS.length) {
        throw error
      }
      await sleep(FILE_WRITE_RETRY_DELAYS_MS[attempt]!)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('文件写入失败')
}

interface TagWriteWaiter {
  resolve: (release: () => void) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

/**
 * Tag writing runs at most one operation at a time process-wide. MP3 still
 * buffers whole files, while FLAC rewrites and cover readback also consume I/O
 * and memory; parallel downloads must not fan out into tag writers. Waiting for
 * the slot is abortable; aborting a queued operation never starts its worker.
 */
class TagWriteGate {
  private active = false
  private waiters: TagWriteWaiter[] = []

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(tagWriteAbortReason(signal))
    if (!this.active) {
      this.active = true
      return Promise.resolve(this.createRelease())
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: TagWriteWaiter = { resolve, reject, signal }
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(tagWriteAbortReason(signal!))
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  private createRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiters.shift()
      if (!next) {
        this.active = false
        return
      }
      if (next.onAbort) next.signal?.removeEventListener('abort', next.onAbort)
      next.resolve(this.createRelease())
    }
  }
}

const tagWriteGate = new TagWriteGate()

export async function withTagWriteSlot<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await tagWriteGate.acquire(signal)
  try {
    signal?.throwIfAborted()
    return await operation()
  } finally {
    release()
  }
}

function tagWriteAbortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  const error = new Error(reason === undefined ? '标签写入已取消' : String(reason))
  error.name = 'AbortError'
  return error
}

export function buildDownloadPath(
  pathFormat: string,
  vars: Record<string, string>,
  ext: string,
): string {
  let rel = pathFormat
  for (const [key, value] of Object.entries(vars)) {
    rel = rel.replace(new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), () => value.trim() ? sanitizePath(value) : '')
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
  if (opts.writeLyrics) {
    const separate = opts.separateLyricFiles && opts.hasTranslatedLyric
    if (separate) {
      status.lyricExists = existsSync(lyricBase + ' (orgi).lrc')
      status.translatedLyricExists = existsSync(lyricBase + ' (trans).lrc')
    } else {
      status.lyricExists = existsSync(lyricBase + '.lrc')
      // In merged mode, translations are in the same .lrc file
      status.translatedLyricExists = opts.hasTranslatedLyric ? status.lyricExists : true
    }
    status.romajiLyricExists = !opts.hasRomajiLyric || existsSync(lyricBase + ' (romaji).lrc')
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
    audioCache?: DownloadAudioCache
    audioCachePath?: string
    commitFile?: (result: DownloadResult, publish: () => void) => Promise<void>
  },
  relativePath: string,
  onProgress?: (pct: number, phase?: 'downloading' | 'tagging') => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const ops: SongOps = {
    download: url ? 'ok' : 'skipped',
    lyric: 'skipped',
    tags: 'skipped',
    cover: 'skipped',
  }

  const albumPath = join(downloadDir, dirname(relativePath))
  signal?.throwIfAborted()
  if (!existsSync(albumPath)) {
    await mkdir(albumPath, { recursive: true })
    signal?.throwIfAborted()
  }

  const filePath = join(downloadDir, relativePath)
  let stagedAudioPath: string | null = null
  let stagedCommitted = false

  try {
    if (options.audioCache) await prepareAudioCache(options.audioCache)
    // Keep the completed raw download separate from the tag writer's working
    // copy. A failed writer may corrupt its input; retries reuse only the raw cache.
    if (url) {
      try {
        const staged = await downloadAudioToFile({
          url,
          targetPath: options.audioCachePath ?? filePath,
          fileType,
          signal,
          onProgress: (progress) => onProgress?.(progress.pct, 'downloading'),
        })
        stagedAudioPath = staged.partPath
        signal?.throwIfAborted()
        if (options.audioCachePath) {
          await rename(stagedAudioPath, options.audioCachePath)
          stagedAudioPath = null
        }
        ops.download = 'ok'
      } catch (error) {
        ops.download = 'failed'
        throw error
      }
    }
    if (options.audioCachePath) {
      signal?.throwIfAborted()
      stagedAudioPath = `${filePath}.part-${randomUUID()}`
      await copyFile(options.audioCachePath, stagedAudioPath)
      signal?.throwIfAborted()
      // This audio was downloaded by this same task, including a previous attempt.
      ops.download = 'ok'
    }

    // Download lyrics — derive path from audio file path
    if (options.writeLyrics) {
      try {
        if (options.lyrics) {
          const lyricBase = filePath.replace(/\.\w+$/, '')
          if (options.separateLyricFiles && options.translatedLyric) {
            await writeFileWithRetry(lyricBase + ' (orgi).lrc', options.lyrics, 'utf-8')
            await writeFileWithRetry(lyricBase + ' (trans).lrc', options.translatedLyric, 'utf-8')
          } else {
            await writeFileWithRetry(lyricBase + '.lrc', options.lyrics, 'utf-8')
          }
          if (options.romajiLyric) {
            await writeFileWithRetry(lyricBase + ' (romaji).lrc', options.romajiLyric, 'utf-8')
          }
          ops.lyric = 'ok'
          signal?.throwIfAborted()
        } else {
          ops.lyric = 'failed'
        }
      } catch {
        signal?.throwIfAborted()
        ops.lyric = 'failed'
      }
    }

    // Download cover once for embed + save
    let imageBuffer: Buffer | null = null
    if (options.embedCover || options.saveAlbumCover) {
      imageBuffer = await downloadImage(meta.picUrl, signal)
    }
    signal?.throwIfAborted()

    const tagImage = options.embedCover && imageBuffer && imageMimeType(imageBuffer) ? imageBuffer : null
    if (options.embedMetadata || tagImage) {
      const tagHeartbeat = setInterval(() => onProgress?.(0, 'tagging'), 2000)
      try {
        // Report tagging phase start so UI shows "写标签" immediately
        onProgress?.(0, 'tagging')
        let tagFilePath = stagedAudioPath ?? filePath

        if (!stagedAudioPath && existsSync(filePath)) {
          // Re-tagging existing audio: copy to a private stage first so a tag
          // failure cannot damage the current media file.
          const retagStagePath = `${filePath}.part-${randomUUID()}`
          stagedAudioPath = retagStagePath
          await copyFile(filePath, retagStagePath)
          tagFilePath = retagStagePath
        }
        signal?.throwIfAborted()

        if (fileType === 'flac') {
          await writeFlacTags(tagFilePath, meta, tagImage, signal, options.embedMetadata)
        } else {
          await writeMp3Tags(tagFilePath, meta, tagImage, signal, options.embedMetadata)
        }
        signal?.throwIfAborted()
        const validation = validateLocalAudioFile(tagFilePath, fileType)
        if (!validation.valid) throw new Error(validation.reason || '标签写入后的音频文件无效')
        if (options.embedMetadata) ops.tags = 'ok'

        if (tagImage) {
          ops.cover = 'ok'
        }

        onProgress?.(100, 'tagging')
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        console.error(`[YunPlex2] 标签写入失败: ${filePath}`, err)
        ops.tags = 'failed'
        if (options.embedCover) ops.cover = 'failed'
        onProgress?.(100, 'tagging')
        throw new TagWriteError({ filePath, fileType, ops, detail, cause: err })
      } finally { clearInterval(tagHeartbeat) }
    }

    if (options.embedCover && !tagImage) ops.cover = 'failed'

    // Save standalone cover images
    const artistPath = dirname(albumPath)
    if (options.saveAlbumCover) {
      try {
        const coverBuf = imageBuffer ?? await downloadImage(meta.picUrl, signal)
        if (coverBuf) await writeFileWithRetry(join(albumPath, 'cover.jpg'), coverBuf)
        signal?.throwIfAborted()
      } catch {
        signal?.throwIfAborted()
        /* non-critical */
      }
    }
    if (options.saveArtistImage && meta.artistImgUrl) {
      const artistImgPath = join(artistPath, 'artist.jpg')
      if (!existsSync(artistImgPath)) {
        try {
          const artistImg = await downloadImage(meta.artistImgUrl, signal)
          if (artistImg) await writeFileWithRetry(artistImgPath, artistImg)
          signal?.throwIfAborted()
        } catch {
          signal?.throwIfAborted()
          /* non-critical */
        }
      }
    }

    signal?.throwIfAborted()
    const publish = () => {
      signal?.throwIfAborted()
      if (stagedAudioPath) {
        renameSync(stagedAudioPath, filePath)
        stagedCommitted = true
      }
    }
    if (options.commitFile) await options.commitFile({ filePath, ops }, publish)
    else publish()
    return { filePath, ops }
  } finally {
    // Never leave an owned .part file behind on failure or cancellation.
    if (stagedAudioPath && !stagedCommitted) {
      await rm(stagedAudioPath, { force: true }).catch(() => undefined)
    }
  }
}

function imageMimeType(buffer: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  return null
}

async function downloadImage(picUrl: string, parentSignal?: AbortSignal): Promise<Buffer | null> {
  try {
    const timeoutSignal = AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS)
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, timeoutSignal])
      : timeoutSignal
    const res = await fetch(picUrl, { signal })
    if (!res.ok || Number(res.headers.get('content-length')) > IMAGE_MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined)
      return null
    }
    const reader = res.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let received = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return Buffer.concat(chunks, received)
        received += value.byteLength
        if (received > IMAGE_MAX_BYTES) { await reader.cancel(); return null }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
  } catch (error) {
    parentSignal?.throwIfAborted()
    if (error instanceof Error && error.name === 'TimeoutError') return null
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
  signal?: AbortSignal,
  writeMetadata = true,
): Promise<void> {
  const tagMap = writeMetadata ? buildFlacTagMap(meta) : {}
  await withTagWriteSlot(signal, () => runFlacTagWorkerInline({ filePath, tagMap, imageBuffer, writeMetadata }, signal))
}

function buildMp3Tags(meta: SongMeta): NodeId3Tags {
  const hasDate = meta.publishTime > 0
  const tags: NodeId3Tags = {
    title: meta.title,
    performerInfo: meta.albumArtist,
    artist: meta.trackArtist || meta.albumArtist,
    album: meta.album,
    trackNumber: meta.totalTracks
      ? `${meta.trackNumber}/${meta.totalTracks}`
      : String(meta.trackNumber),
    year: undefined,
    date: undefined,
    length: undefined,
    partOfSet: undefined,
    genre: undefined,
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
  return tags
}

export async function writeMp3Tags(
  filePath: string,
  meta: SongMeta,
  imageBuffer: Buffer | null,
  signal?: AbortSignal,
  writeMetadata = true,
): Promise<void> {
  const tags: NodeId3Tags = writeMetadata ? buildMp3Tags(meta) : {}
  if (imageBuffer) {
    tags.image = {
      mime: imageMimeType(imageBuffer) ?? 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'cover',
      imageBuffer,
    }
  }

  // Offload MP3 tag writing to a worker thread — node-id3 uses
  // readFileSync / writeFileSync internally which blocks the event loop.
  await withTagWriteSlot(signal, () => runMp3TagWorkerInline({
    filePath,
    tags: tags as unknown as Record<string, unknown>,
    imageBuffer,
  }, signal))
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
