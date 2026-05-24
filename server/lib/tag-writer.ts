import { existsSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execCb)
import NodeID3 from 'node-id3'
import flacMetadata from 'metaflac-js'
import dayjs from 'dayjs'
import type { SongTask } from './job/types'

const NodeID3tag = NodeID3.Promise

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

type OpResult = 'ok' | 'failed' | 'skipped'

export type SongOps = NonNullable<SongTask['ops']>

export interface DownloadResult {
  filePath: string
  ops: SongOps
}

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

export async function downloadSong(
  url: string,
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
    separateLyricFiles?: boolean
  },
  relativePath: string,
): Promise<DownloadResult> {
  const ops: SongOps = {
    download: 'ok',
    lyric: 'skipped',
    tags: 'skipped',
    cover: 'skipped',
  }

  const albumPath = join(downloadDir, dirname(relativePath))
  if (!existsSync(albumPath)) {
    await mkdir(albumPath, { recursive: true })
  }

  const filePath = join(downloadDir, relativePath)

  // Download audio file
  try {
    const songRes = await fetch(url)
    const buffer = Buffer.from(await songRes.arrayBuffer())
    await writeFile(filePath, buffer)
    ops.download = 'ok'
  } catch {
    ops.download = 'failed'
    return { filePath, ops }
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
    } catch {
      ops.tags = 'failed'
      ops.cover = 'failed'
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

function buildFlacTagMap(meta: SongMeta): Record<string, string> {
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

async function writeFlacTags(
  filePath: string,
  meta: SongMeta,
  imageBuffer: Buffer | null,
): Promise<void> {
  const tagMap = buildFlacTagMap(meta)

  try {
    const flac = new flacMetadata(filePath)
    for (const [key, value] of Object.entries(tagMap)) {
      flac.setTag(`${key}=${value}`)
    }

    const MAX_SIZE = 16777215
    if (imageBuffer && imageBuffer.byteLength <= MAX_SIZE) {
      flac.importPictureFromBuffer(imageBuffer)
    }
    await flac.save()
  } catch {
    // metaflac-js failed — fall back to CLI metaflac
    for (const [key, value] of Object.entries(tagMap)) {
      const escaped = value.replace(/"/g, '\\"')
      await execAsync(`metaflac --remove-tag=${key} "${filePath}" 2>/dev/null; metaflac --set-tag="${key}=${escaped}" "${filePath}"`)
    }
    if (imageBuffer) {
      const tempCover = join(dirname(filePath), 'cover.jpg')
      await writeFile(tempCover, imageBuffer)
      await execAsync(`metaflac --remove --block-type=PICTURE "${filePath}"`)
      await execAsync(`metaflac --import-picture-from="${tempCover}" "${filePath}"`)
    }
  }
}

async function writeMp3Tags(
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

  await NodeID3tag.write(tags, filePath)
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
