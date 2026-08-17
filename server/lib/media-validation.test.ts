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
  it('accepts a FLAC container after an ID3v2 metadata prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yunplex-media-validation-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'tagged.flac')
    const id3Header = Buffer.from([
      0x49, 0x44, 0x33, // ID3
      0x03, 0x00, // version 2.3
      0x00, // flags
      0x00, 0x00, 0x00, 0x04, // four-byte synchsafe payload size
    ])
    writeFileSync(filePath, Buffer.concat([
      id3Header,
      Buffer.from('tags'),
      Buffer.from('fLaCmetadata'),
    ]))

    expect(validateLocalAudioFile(filePath)).toEqual({ valid: true })
  })

  it('rejects an ID3-prefixed file without a FLAC container', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yunplex-media-validation-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'fake.flac')
    writeFileSync(filePath, Buffer.from([
      0x49, 0x44, 0x33,
      0x03, 0x00,
      0x00,
      0x00, 0x00, 0x00, 0x04,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]))

    expect(validateLocalAudioFile(filePath)).toEqual({
      valid: false,
      reason: 'FLAC 文件头无效',
    })
  })

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
