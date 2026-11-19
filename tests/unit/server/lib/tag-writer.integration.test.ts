import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFile } from 'music-metadata'
import { downloadSong, writeFlacTags, writeMp3Tags, type SongMeta } from '~~/server/lib/tag-writer'
import { id3Prefix, inspectFlac, jpegCover, makeFlac, pictureBlock, pngCover } from '../../../helpers/flac-fixture'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeMeta(overrides: Partial<SongMeta> = {}): SongMeta {
  return {
    title: 'First title',
    albumArtist: 'First artist',
    trackArtist: 'First artist',
    album: 'First album',
    trackNumber: 1,
    publishTime: new Date('2024-01-01T00:00:00.000Z').getTime(),
    picUrl: '',
    duration: 180000,
    discNumber: '1',
    totalDiscs: 1,
    totalTracks: 10,
    genre: 'Rock',
    releaseDate: '2024-01-01',
    albumDescription: 'First description',
    recordLabel: 'First label',
    releaseType: 'Album',
    artistImgUrl: '',
    ...overrides,
  }
}

function workingFile(bytes = makeFlac()): string {
  const dir = mkdtempSync(join(tmpdir(), 'yunplex-flac-tag-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'song.flac.part-fixture')
  writeFileSync(filePath, bytes)
  return filePath
}

async function rawTags(path: string): Promise<string[]> {
  const result = await parseFile(path)
  return (result.native.vorbis ?? []).filter(tag => typeof tag.value === 'string').map(tag => tag.id + '=' + tag.value)
}

describe('writeFlacTags integration', () => {
  it('replaces managed fields instead of accumulating duplicate Vorbis comments', async () => {
    const filePath = workingFile(makeFlac({ comments: ['title=old', 'TITLE=duplicate'], padding: 32 }))

    await writeFlacTags(filePath, makeMeta(), null)
    await writeFlacTags(filePath, makeMeta({
      title: 'Second title',
      albumArtist: 'Second artist',
      trackArtist: 'Second artist',
      album: 'Second album',
      publishTime: 0,
      duration: 0,
      totalTracks: 0,
      genre: '',
      releaseDate: '',
      albumDescription: '',
      recordLabel: '',
      releaseType: '',
    }), null)

    const tags = await rawTags(filePath)
    expect(tags.filter((tag) => tag.startsWith('TITLE='))).toEqual(['TITLE=Second title'])
    expect(tags.filter((tag) => tag.startsWith('ARTIST='))).toEqual(['ARTIST=Second artist'])
    expect(tags.filter((tag) => tag.startsWith('ALBUM='))).toEqual(['ALBUM=Second album'])
    expect(tags.some((tag) => /^(YEAR|DATE|LENGTH|TOTALTRACKS|GENRE|DESCRIPTION|PUBLISHER|RELEASETYPE)=/.test(tag))).toBe(false)
  })

  it('writes every managed field without padding or an existing comment block', async () => {
    const input = makeFlac()
    const filePath = workingFile(input)
    await writeFlacTags(filePath, makeMeta({
      title: '中文歌曲 🎵', trackArtist: '艺人甲 / Artist B', discNumber: '2', totalDiscs: 3,
      albumDescription: '第一行\n第二行', recordLabel: '独立厂牌',
    }), pngCover)
    const result = await parseFile(filePath)
    expect(result.common.title).toBe('中文歌曲 🎵')
    expect(await rawTags(filePath)).toEqual(expect.arrayContaining([
      'DISCNUMBER=2/3', 'DISCTOTAL=3', 'TOTALTRACKS=10', 'YEAR=2024', 'DATE=2024-01-01',
      'DESCRIPTION=第一行\n第二行', 'PUBLISHER=独立厂牌', 'RELEASETYPE=Album', 'LENGTH=3:00',
    ]))
    expect(Buffer.from(result.common.picture![0]!.data)).toEqual(pngCover)
    expect(inspectFlac(readFileSync(filePath)).audio).toEqual(inspectFlac(input).audio)
  })

  it('retains custom multi-value tags, opaque blocks, back covers and encoded audio', async () => {
    const extras = [
      { type: 2, body: Buffer.from('TESTapplication payload') },
      { type: 7, body: Buffer.from('future metadata') },
      pictureBlock(4), pictureBlock(3), pictureBlock(3),
    ]
    const input = makeFlac({ comments: ['MUSICBRAINZ_TRACKID=id-1', 'REPLAYGAIN_TRACK_GAIN=-7.2 dB', 'CUSTOM=甲', 'CUSTOM=乙'], extra: extras })
    const filePath = workingFile(input)
    await writeFlacTags(filePath, makeMeta(), jpegCover)
    await writeFlacTags(filePath, makeMeta({ title: 'Second' }), jpegCover)
    expect(await rawTags(filePath)).toEqual(expect.arrayContaining(['CUSTOM=甲', 'CUSTOM=乙', 'MUSICBRAINZ_TRACKID=id-1', 'REPLAYGAIN_TRACK_GAIN=-7.2 dB']))
    const actual = inspectFlac(readFileSync(filePath))
    for (const extra of extras.slice(0, 3)) expect(actual.blocks).toContainEqual(extra)
    expect(actual.blocks.filter(block => block.type === 6)).toHaveLength(2)
    expect(actual.audio).toEqual(inspectFlac(input).audio)
  })

  it('keeps all text unchanged when only replacing the front cover', async () => {
    const input = makeFlac({ comments: ['TITLE=原始标题', 'YEAR=1998', 'CUSTOM=keep'], extra: [pictureBlock(4), pictureBlock(3)] })
    const filePath = workingFile(input)
    const before = await rawTags(filePath)
    await writeFlacTags(filePath, makeMeta(), jpegCover, undefined, false)
    expect(await rawTags(filePath)).toEqual(before)
    const result = await parseFile(filePath)
    expect(result.common.picture).toHaveLength(2)
    expect(Buffer.from(result.common.picture!.find(pic => pic.type === 'Cover (back)')!.data)).toEqual(pngCover)
  })

  it('keeps existing picture blocks unchanged when only writing text', async () => {
    const picture = pictureBlock(4)
    const filePath = workingFile(makeFlac({ extra: [picture, pictureBlock(3)] }))
    const before = inspectFlac(readFileSync(filePath)).blocks.filter(block => block.type === 6)
    await writeFlacTags(filePath, makeMeta(), null)
    expect(inspectFlac(readFileSync(filePath)).blocks.filter(block => block.type === 6)).toEqual(before)
  })

  it.each([false, true])('strips a leading ID3v2 prefix (footer: %s) without changing audio', async (footer) => {
    const input = makeFlac({ comments: ['CUSTOM=keep'] })
    const filePath = workingFile(Buffer.concat([id3Prefix(footer), input]))
    await writeFlacTags(filePath, makeMeta(), null)
    const result = readFileSync(filePath)
    expect(result.subarray(0, 4).toString()).toBe('fLaC')
    expect(inspectFlac(result).audio).toEqual(inspectFlac(input).audio)
    expect(await rawTags(filePath)).toContain('CUSTOM=keep')
  })

  it('keeps the original and removes its stage when native parsing fails', async () => {
    const corrupt = Buffer.from('fLaC\x80\x00\x00\x22truncated')
    const filePath = workingFile(corrupt)
    const dir = join(filePath, '..')
    await expect(downloadSong(undefined, makeMeta(), 'flac', dir, {
      writeLyrics: false, embedMetadata: true, embedCover: false,
      saveAlbumCover: false, saveArtistImage: false,
    }, 'song.flac.part-fixture')).rejects.toThrow('标签写入失败')
    expect(readFileSync(filePath)).toEqual(corrupt)
    expect(readdirSync(dir)).toEqual(['song.flac.part-fixture'])
  })

  it('does not publish a write whose independent readback detects changed text', async () => {
    const original = makeFlac({ comments: ['TITLE=Original'] })
    const filePath = workingFile(original)
    const dir = join(filePath, '..')
    // A lone surrogate is replaced by UTF-8 encoding; the reader must catch
    // that the writer did not retain the requested title before publication.
    await expect(downloadSong(undefined, makeMeta({ title: '\ud800' }), 'flac', dir, {
      writeLyrics: false, embedMetadata: true, embedCover: false,
      saveAlbumCover: false, saveArtistImage: false,
    }, 'song.flac.part-fixture')).rejects.toThrow('标签回读核验失败: TITLE')
    expect(readFileSync(filePath)).toEqual(original)
    expect(readdirSync(dir)).toEqual(['song.flac.part-fixture'])
  })

  it.skipIf(process.getuid?.() === 0)('retains filesystem error codes for the queue pause policy', async () => {
    const filePath = workingFile()
    chmodSync(filePath, 0)
    try { await expect(writeFlacTags(filePath, makeMeta(), null)).rejects.toMatchObject({ code: 'EACCES' }) }
    finally { chmodSync(filePath, 0o600) }
  })

  it('reads back MP3 text and its front cover through the existing writer', async () => {
    const filePath = workingFile()
    copyFileSync(new URL('../../../fixtures/silence.mp3', import.meta.url), filePath)
    await writeMp3Tags(filePath, makeMeta(), jpegCover)
    const result = await parseFile(filePath)
    expect(result.common.title).toBe('First title')
    expect(result.common.albumartist).toBe('First artist')
    expect(result.common.track).toEqual({ no: 1, of: 10 })
    expect(Buffer.from(result.common.picture![0]!.data)).toEqual(jpegCover)
  })

  it('accepts MP3 slash-separated artists and an unknown track number during readback', async () => {
    const filePath = workingFile()
    copyFileSync(new URL('../../../fixtures/silence.mp3', import.meta.url), filePath)
    await writeMp3Tags(filePath, makeMeta({ trackArtist: '艺人甲 / Artist B', trackNumber: 0 }), null)
    const result = await parseFile(filePath)
    expect(result.common.artists).toEqual(['艺人甲', 'Artist B'])
    expect(result.native['ID3v2.3']).toContainEqual({ id: 'TRCK', value: '0/10' })
  })
})
