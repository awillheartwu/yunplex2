import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { writeFlacTags, type SongMeta } from './tag-writer'

const require = createRequire(import.meta.url)
const Metaflac = require('metaflac-js') as {
  new (filePath: string): { getAllTags(): string[] }
}

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

function buildMinimalFlac(): Buffer {
  const streamInfo = Buffer.alloc(34)
  const vorbisComment = Buffer.alloc(8)
  // Empty vendor string + zero user comments.
  vorbisComment.writeUInt32LE(0, 0)
  vorbisComment.writeUInt32LE(0, 4)
  const block = (type: number, body: Buffer, isLast = false) => Buffer.concat([
    Buffer.from([type + (isLast ? 128 : 0), (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff]),
    body,
  ])

  return Buffer.concat([
    Buffer.from('fLaC'),
    block(0, streamInfo),
    block(4, vorbisComment),
    block(1, Buffer.alloc(32), true),
  ])
}

describe('writeFlacTags integration', () => {
  it('replaces managed fields instead of accumulating duplicate Vorbis comments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yunplex-flac-tag-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'song.flac')
    writeFileSync(filePath, buildMinimalFlac())

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

    const tags = new Metaflac(filePath).getAllTags()
    expect(tags.filter((tag) => tag.startsWith('TITLE='))).toEqual(['TITLE=Second title'])
    expect(tags.filter((tag) => tag.startsWith('ARTIST='))).toEqual(['ARTIST=Second artist'])
    expect(tags.filter((tag) => tag.startsWith('ALBUM='))).toEqual(['ALBUM=Second album'])
    expect(tags.some((tag) => /^(YEAR|DATE|LENGTH|TOTALTRACKS|GENRE|DESCRIPTION|PUBLISHER|RELEASETYPE)=/.test(tag))).toBe(false)
  })
})
