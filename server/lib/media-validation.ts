import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { extname } from 'node:path'

export interface AudioValidationResult {
  valid: boolean
  reason?: string
}

/**
 * Lightweight structural gate for media we download or reuse. This deliberately
 * validates only container signatures: it is fast enough for the sync hot path,
 * catches empty/zero-filled files, and does not require spawning ffprobe.
 */
export function validateAudioBuffer(buffer: Uint8Array, fileType: string): AudioValidationResult {
  const type = fileType.toLowerCase().replace(/^\./, '')

  if (type === 'flac') {
    return hasPrefix(buffer, 'fLaC')
      ? { valid: true }
      : { valid: false, reason: 'FLAC 文件头无效' }
  }

  if (type === 'mp3') {
    const hasId3 = hasPrefix(buffer, 'ID3')
    const hasFrameSync = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0
    return hasId3 || hasFrameSync
      ? { valid: true }
      : { valid: false, reason: 'MP3 文件头无效' }
  }

  if (type === 'm4a' || type === 'mp4') {
    return buffer.length >= 8 && textAt(buffer, 4, 4) === 'ftyp'
      ? { valid: true }
      : { valid: false, reason: 'M4A 文件头无效' }
  }

  if (type === 'aac') {
    const hasAdtsSync = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xf6) === 0xf0
    return hasAdtsSync
      ? { valid: true }
      : { valid: false, reason: 'AAC 文件头无效' }
  }

  if (type === 'ogg') {
    return hasPrefix(buffer, 'OggS')
      ? { valid: true }
      : { valid: false, reason: 'OGG 文件头无效' }
  }

  if (type === 'wav') {
    return hasPrefix(buffer, 'RIFF') && textAt(buffer, 8, 4) === 'WAVE'
      ? { valid: true }
      : { valid: false, reason: 'WAV 文件头无效' }
  }

  // Keep unfamiliar formats backward-compatible; they are not emitted by the
  // downloader today and should not be accidentally discarded by a sync.
  return { valid: true }
}

/**
 * Validate an on-disk audio file using a bounded header read.
 *
 * Pass `explicitFileType` when the file name hides its container (for example a
 * staged `song.flac.part-<uuid>` file); otherwise the extension is used.
 */
export function validateLocalAudioFile(filePath: string, explicitFileType?: string): AudioValidationResult {
  try {
    const fileSize = statSync(filePath).size
    if (fileSize === 0) {
      return { valid: false, reason: '音频文件为空' }
    }

    const fd = openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(16)
      const bytesRead = readSync(fd, header, 0, header.length, 0)
      const initial = header.subarray(0, bytesRead)
      const fileType = explicitFileType && explicitFileType.trim()
        ? explicitFileType
        : extname(filePath)
      const directResult = validateAudioBuffer(initial, fileType)
      if (directResult.valid || normalizeAudioFileType(fileType) !== 'flac' || !hasPrefix(initial, 'ID3')) {
        return directResult
      }

      const flacOffset = id3v2PayloadEndOffset(initial, fileSize)
      if (flacOffset === null) return directResult
      return readPrefixAt(fd, flacOffset, 'fLaC')
        ? { valid: true }
        : { valid: false, reason: 'FLAC 文件头无效' }
    } finally {
      closeSync(fd)
    }
  } catch {
    return { valid: false, reason: '无法读取音频文件' }
  }
}

export function normalizeAudioFileType(fileType: string): string {
  return fileType.toLowerCase().replace(/^\./, '')
}

function id3v2PayloadEndOffset(header: Uint8Array, fileSize: number): number | null {
  if (header.length < 10 || !hasPrefix(header, 'ID3')) return null
  const sizeBytes = [header[6], header[7], header[8], header[9]]
  if (sizeBytes.some(value => value === undefined)) return null
  const definedSizeBytes = sizeBytes as number[]
  if (definedSizeBytes.some(value => (value & 0x80) !== 0)) return null

  const payloadSize = definedSizeBytes.reduce((size, value) => (size << 7) | value, 0)
  const footerSize = (header[5]! & 0x10) !== 0 ? 10 : 0
  const offset = 10 + payloadSize + footerSize
  return offset + 4 <= fileSize ? offset : null
}

function readPrefixAt(fd: number, offset: number, value: string): boolean {
  const signature = Buffer.alloc(value.length)
  const bytesRead = readSync(fd, signature, 0, signature.length, offset)
  return bytesRead === signature.length && hasPrefix(signature, value)
}

function hasPrefix(buffer: Uint8Array, value: string): boolean {
  return textAt(buffer, 0, value.length) === value
}

function textAt(buffer: Uint8Array, offset: number, length: number): string {
  if (buffer.length < offset + length) return ''
  return Buffer.from(buffer.subarray(offset, offset + length)).toString('ascii')
}
