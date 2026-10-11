import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadSong, type SongMeta } from '~~/server/lib/tag-writer'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const meta: SongMeta = {
  title: 'Test song',
  albumArtist: 'Test artist',
  trackArtist: 'Test artist',
  album: 'Test album',
  trackNumber: 1,
  publishTime: 0,
  picUrl: '',
  duration: 0,
  discNumber: '1',
  totalDiscs: 1,
  totalTracks: 0,
  genre: '',
  releaseDate: '',
  albumDescription: '',
  recordLabel: '',
  releaseType: '',
  artistImgUrl: '',
}

describe('downloadSong media validation', () => {
  it('rejects an invalid FLAC response before it can replace a local file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yunplex-download-validation-'))
    tempDirs.push(dir)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.alloc(1024), {
      status: 200,
      headers: { 'content-length': '1024' },
    })))

    await expect(downloadSong('https://example.test/song.flac', meta, 'flac', dir, {
      writeLyrics: false,
      embedMetadata: false,
      embedCover: false,
      saveAlbumCover: false,
      saveArtistImage: false,
    }, 'song.flac')).rejects.toThrow('FLAC 文件头无效')

    expect(existsSync(join(dir, 'song.flac'))).toBe(false)
  })

  it('publishes a validated download atomically without leaving a partial file behind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yunplex-download-validation-'))
    tempDirs.push(dir)
    const audio = Buffer.from('fLaCvalidated-audio')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(audio, {
      status: 200,
      headers: { 'content-length': String(audio.length) },
    })))

    const result = await downloadSong('https://example.test/song.flac', meta, 'flac', dir, {
      writeLyrics: false,
      embedMetadata: false,
      embedCover: false,
      saveAlbumCover: false,
      saveArtistImage: false,
    }, 'song.flac')

    expect(result.ops.download).toBe('ok')
    expect(existsSync(join(dir, 'song.flac'))).toBe(true)
    expect(readdirSync(dir)).toEqual(['song.flac'])
  })
})
