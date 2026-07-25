import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateAudioBuffer, validateLocalAudioFile } from './media-validation'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('validateAudioBuffer', () => {
  it('accepts known FLAC and MP3 container signatures', () => {
    expect(validateAudioBuffer(Buffer.from('fLaCmetadata'), 'flac')).toEqual({ valid: true })
    expect(validateAudioBuffer(Buffer.from('ID3metadata'), 'mp3')).toEqual({ valid: true })
  })

  it('rejects zero-filled media masquerading as a FLAC', () => {
    expect(validateAudioBuffer(Buffer.alloc(16), 'flac')).toEqual({
      valid: false,
      reason: 'FLAC 文件头无效',
    })
  })
})

describe('validateLocalAudioFile', () => {
  it('recognises a corrupt on-disk FLAC as invalid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yunplex-media-validation-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'corrupt.flac')
    writeFileSync(filePath, Buffer.alloc(256))

    expect(validateLocalAudioFile(filePath)).toEqual({
      valid: false,
      reason: 'FLAC 文件头无效',
    })
  })
})
