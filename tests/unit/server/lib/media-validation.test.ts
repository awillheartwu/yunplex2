import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateAudioBuffer, validateLocalAudioFile } from '~~/server/lib/media-validation'

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

describe('validateLocalAudioFile with explicit file type', () => {
  it('validates staged .part filenames using the explicit container type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yunplex-media-validation-'))
    tempDirs.push(dir)
    const staged = join(dir, 'song.flac.part-0e7b9f')
    const id3Header = Buffer.from([
      0x49, 0x44, 0x33, // ID3
      0x03, 0x00, // version 2.3
      0x00, // flags
      0x00, 0x00, 0x00, 0x04, // four-byte synchsafe payload size
    ])
    writeFileSync(staged, Buffer.concat([
      id3Header,
      Buffer.from('tags'),
      Buffer.from('fLaCmetadata'),
    ]))

    expect(validateLocalAudioFile(staged, 'flac')).toEqual({ valid: true })
    // A leading dot in the explicit type is tolerated.
    expect(validateLocalAudioFile(staged, '.flac')).toEqual({ valid: true })
  })

  it('rejects staged content that does not match the explicit file type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yunplex-media-validation-'))
    tempDirs.push(dir)
    const staged = join(dir, 'song.flac.part-0e7b9f')
    writeFileSync(staged, Buffer.alloc(128))

    expect(validateLocalAudioFile(staged, 'flac')).toEqual({
      valid: false,
      reason: 'FLAC 文件头无效',
    })
  })

  it('accepts a bare MP3 frame sync signature at a staged path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yunplex-media-validation-'))
    tempDirs.push(dir)
    const staged = join(dir, 'song.mp3.part-0e7b9f')
    writeFileSync(staged, Buffer.from([0xff, 0xfb, 0x90, 0x00]))

    expect(validateLocalAudioFile(staged, 'mp3')).toEqual({ valid: true })
  })
})
