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

export function validateLocalAudioFile(filePath: string): AudioValidationResult {
  try {
    if (statSync(filePath).size === 0) {
      return { valid: false, reason: '音频文件为空' }
    }

    const fd = openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(16)
      const bytesRead = readSync(fd, header, 0, header.length, 0)
      return validateAudioBuffer(header.subarray(0, bytesRead), extname(filePath))
    } finally {
      closeSync(fd)
    }
  } catch {
    return { valid: false, reason: '无法读取音频文件' }
  }
}

function hasPrefix(buffer: Uint8Array, value: string): boolean {
  return textAt(buffer, 0, value.length) === value
}

function textAt(buffer: Uint8Array, offset: number, length: number): string {
  if (buffer.length < offset + length) return ''
  return Buffer.from(buffer.subarray(offset, offset + length)).toString('ascii')
}
