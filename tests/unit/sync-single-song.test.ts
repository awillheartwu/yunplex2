import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Netease API module
vi.mock('../../server/lib/netease', () => ({
  fetchSongDetail: vi.fn(),
  getSongUrl: vi.fn(),
  fetchLyric: vi.fn(),
  fetchAlbumDetail: vi.fn(),
}))

// Mock the tag-writer module
vi.mock('../../server/lib/tag-writer', () => ({
  downloadSong: vi.fn(),
  buildDownloadPath: vi.fn((format, vars, ext) => {
    const result = format
      .replace('{artist}', vars.artist || '')
      .replace('{album}', vars.album || '')
      .replace('{title}', vars.title || '')
      .replace('{year}', vars.year || '')
      .replace('{track}', vars.track || '')
      .replace('{track:02d}', vars['track:02d'] || '')
    return result + '.' + ext
  }),
  checkAncillaryFiles: vi.fn(() => ({
    lyricExists: false,
    translatedLyricExists: false,
    romajiLyricExists: false,
    coverExists: false,
    artistImageExists: false,
  })),
}))

// Mock the artist-utils module
vi.mock('../../server/lib/sync/artist-utils', () => ({
  createSplitArtists: vi.fn(() => (artists: { name: string }[]) => {
    const names = artists.map((a) => a.name)
    return [names[0] || '', names.slice(1).join(', ')]
  }),
}))

// Mock existsSync
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}))

vi.mock('../../server/lib/sync/local-media-store', () => ({
  getLocalMediaAsset: vi.fn(() => null),
  upsertLocalMediaAsset: vi.fn(),
}))
vi.mock('../../server/lib/media-validation', () => ({
  validateLocalAudioFile: vi.fn(() => ({ valid: true })),
}))

import { downloadSingleSong } from '../../server/lib/download/single-song'
import type { SingleSongConfig } from '../../server/lib/download/single-song'
import { fetchSongDetail, getSongUrl, fetchLyric, fetchAlbumDetail } from '../../server/lib/netease'
import { downloadSong } from '../../server/lib/tag-writer'
import { existsSync } from 'node:fs'
import { validateLocalAudioFile } from '../../server/lib/media-validation'

const mockConfig: SingleSongConfig = {
  quality: 'lossless',
  cookie: 'test-cookie',
  downloadDir: '/tmp/music',
  pathFormat: '{artist}/{album} ({year})/{title}',
  multiArtistFormat: 'ampersand',
  downloadLyrics: true,
  embedMetadata: true,
  embedCover: true,
  saveAlbumCover: false,
  saveArtistImage: false,
  lyricOrder: 'original_first',
  downloadTranslatedLyric: true,
  downloadRomajiLyric: false,
}

const albumPublishTime = new Date('2023-11-15T12:00:00').getTime()

const mockSong = {
  id: 123456,
  name: 'Test Song',
  no: 3,
  dt: 240000,
  disc: '1',
  artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
  album: {
    id: 999,
    name: 'Test Album',
    picUrl: 'https://example.com/cover.jpg',
    publishTime: albumPublishTime,
  },
}

describe('downloadSingleSong', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchSongDetail).mockResolvedValue(mockSong)
    vi.mocked(getSongUrl).mockResolvedValue({ url: 'https://example.com/song.flac', type: 'flac' })
    vi.mocked(fetchLyric).mockResolvedValue({
      original: '[00:01]Original',
      translated: '[00:01]Translated',
      romaji: '[00:01]ro ma ji',
      merged: '[00:01]Original\n[00:01]Translated',
      separateFiles: false,
    })
    vi.mocked(fetchAlbumDetail).mockResolvedValue({
      name: 'Test Album',
      picUrl: 'https://example.com/cover.jpg',
      publishTime: albumPublishTime,
      company: 'Test Label',
      description: 'Test desc',
      genre: 'Pop',
      subType: '录音室版',
      artist: 'Artist A',
      size: 10,
      totalDiscs: 1,
      type: '专辑',
      artistImgUrl: 'https://example.com/artist.jpg',
    })
    vi.mocked(downloadSong).mockResolvedValue({
      filePath: '/tmp/music/Artist A/Test Album (2023)/Test Song.flac',
      ops: { download: 'ok', lyric: 'ok', tags: 'ok', cover: 'skipped' },
    })
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(validateLocalAudioFile).mockReturnValue({ valid: true })
  })

  it('calls the full download pipeline in order', async () => {
    const result = await downloadSingleSong(123456, mockConfig)

    expect(fetchSongDetail).toHaveBeenCalledWith(123456, 'test-cookie')
    expect(getSongUrl).toHaveBeenCalledWith(123456, 'lossless', 'test-cookie')
    expect(fetchLyric).toHaveBeenCalledWith(123456, 'test-cookie', 'original_first', true)
    expect(fetchAlbumDetail).toHaveBeenCalledWith(999, 'test-cookie')
    expect(downloadSong).toHaveBeenCalled()

    expect(result.filePath).toBe('/tmp/music/Artist A/Test Album (2023)/Test Song.flac')
    expect(result.fileType).toBe('flac')
    expect(result.ops.download).toBe('ok')
  })

  it('skips audio download but writes ancillary files when audio exists in full mode', async () => {
    vi.mocked(existsSync).mockReturnValue(true)

    await downloadSingleSong(123456, mockConfig)

    // downloadSong should still be called to write ancillary files
    expect(downloadSong).toHaveBeenCalledWith(
      undefined, // url is undefined because audio exists
      expect.any(Object),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        writeLyrics: true, // lyrics still written in full mode
      }),
      expect.any(String),
      undefined,
    )
    // url is undefined so ops.download comes back as 'skipped' from downloadSong mock
  })

  it('skips ancillary files in missing mode when all files exist', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    const { checkAncillaryFiles } = await import('../../server/lib/tag-writer')
    vi.mocked(checkAncillaryFiles).mockReturnValue({
      lyricExists: true,
      translatedLyricExists: true,
      romajiLyricExists: true,
      coverExists: true,
      artistImageExists: true,
    })

    await downloadSingleSong(123456, {
      ...mockConfig,
      saveAlbumCover: true,
      saveArtistImage: true,
      downloadRomajiLyric: true,
      downloadMode: 'missing',
    })

    expect(downloadSong).toHaveBeenCalledWith(
      undefined,
      expect.any(Object),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        writeLyrics: false,    // all lyrics exist → skipped
        saveAlbumCover: false,  // cover exists → skipped
        saveArtistImage: false, // artist image exists → skipped
      }),
      expect.any(String),
      undefined,
    )
  })

  it('writes ancillary files in missing mode when files are absent', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    const { checkAncillaryFiles } = await import('../../server/lib/tag-writer')
    vi.mocked(checkAncillaryFiles).mockReturnValue({
      lyricExists: false,
      translatedLyricExists: false,
      romajiLyricExists: false,
      coverExists: false,
      artistImageExists: false,
    })

    await downloadSingleSong(123456, {
      ...mockConfig,
      saveAlbumCover: true,
      saveArtistImage: true,
      downloadRomajiLyric: true,
      downloadMode: 'missing',
    })

    expect(downloadSong).toHaveBeenCalledWith(
      undefined,
      expect.any(Object),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        writeLyrics: true,     // lyrics missing → written
        saveAlbumCover: true,  // cover missing → saved
        saveArtistImage: true, // artist image missing → saved
      }),
      expect.any(String),
      undefined,
    )
  })

  it('defaults to full mode when downloadMode is omitted', async () => {
    vi.mocked(existsSync).mockReturnValue(true)

    // mockConfig does NOT include downloadMode
    await downloadSingleSong(123456, mockConfig)

    // In full mode with existing audio: url should be undefined, but ancillary files written
    expect(downloadSong).toHaveBeenCalledWith(
      undefined,
      expect.any(Object),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ writeLyrics: true }),
      expect.any(String),
      undefined,
    )
  })

  it('always fetches and replaces existing audio in replace mode', async () => {
    const overridePath = '/tmp/music/Old Artist/Old Album (2020)/Test Song.flac'
    vi.mocked(existsSync).mockImplementation((p) => p === overridePath)

    const result = await downloadSingleSong(123456, {
      ...mockConfig,
      target: { kind: 'existing', path: overridePath },
      downloadMode: 'replace',
    })

    expect(getSongUrl).toHaveBeenCalledWith(123456, 'lossless', 'test-cookie')
    expect(result.audioOperation).toBe('redownloaded')
    expect(downloadSong).toHaveBeenCalledWith(
      'https://example.com/song.flac',
      expect.any(Object),
      'flac',
      expect.any(String),
      expect.objectContaining({ writeLyrics: true }),
      'Old Artist/Old Album (2020)/Test Song.flac',
      undefined,
    )
  })

  it('does not write a changed audio format into the old extension', async () => {
    const overridePath = '/tmp/music/Old Artist/Old Album (2020)/Test Song.flac'
    vi.mocked(existsSync).mockImplementation((p) => p === overridePath)
    vi.mocked(getSongUrl).mockResolvedValue({ url: 'https://example.com/song.mp3', type: 'mp3' })

    await downloadSingleSong(123456, {
      ...mockConfig,
      target: { kind: 'existing', path: overridePath },
      downloadMode: 'replace',
    })

    expect(downloadSong).toHaveBeenCalledWith(
      'https://example.com/song.mp3',
      expect.any(Object),
      'mp3',
      expect.any(String),
      expect.any(Object),
      'Artist A/Test Album (2023)/Test Song.mp3',
      undefined,
    )
  })

  it('downloads beside a protected external path instead of overwriting it', async () => {
    const protectedPath = '/tmp/music/Artist A/Test Album (2023)/Test Song.flac'

    await downloadSingleSong(123456, {
      ...mockConfig,
      target: { kind: 'computed', protectedPath },
    })

    expect(downloadSong).toHaveBeenCalledWith(
      'https://example.com/song.flac',
      expect.any(Object),
      'flac',
      '/tmp/music',
      expect.any(Object),
      'Artist A/Test Album (2023)/Test Song (YunPlex).flac',
      undefined,
    )
  })

  it('uses audioPath override for ancillary file location', async () => {
    const overridePath = '/tmp/music/Old Artist/Old Album (2020)/Test Song.flac'
    vi.mocked(existsSync).mockImplementation((p) => p === overridePath)

    await downloadSingleSong(123456, {
      ...mockConfig,
      target: { kind: 'existing', path: overridePath },
      downloadMode: 'missing',
    })

    expect(downloadSong).toHaveBeenCalledWith(
      undefined,
      expect.any(Object),
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      'Old Artist/Old Album (2020)/Test Song.flac',
      undefined,
    )
  })

  it('does not request a download URL when missing-mode repairs an existing audioPath', async () => {
    const overridePath = '/tmp/music/Old Artist/Old Album (2020)/Test Song.flac'
    vi.mocked(existsSync).mockImplementation((p) => p === overridePath)
    vi.mocked(getSongUrl).mockRejectedValue(new Error('No URL available'))

    await downloadSingleSong(123456, {
      ...mockConfig,
      target: { kind: 'existing', path: overridePath },
      downloadMode: 'missing',
    })

    expect(getSongUrl).not.toHaveBeenCalled()
    expect(downloadSong).toHaveBeenCalledWith(
      undefined,
      expect.any(Object),
      'flac',
      expect.any(String),
      expect.any(Object),
      'Old Artist/Old Album (2020)/Test Song.flac',
      undefined,
    )
  })

  it('re-downloads an invalid existing audioPath instead of treating it as complete', async () => {
    const overridePath = '/tmp/music/Old Artist/Old Album (2020)/Test Song.flac'
    vi.mocked(existsSync).mockImplementation((p) => p === overridePath)
    vi.mocked(validateLocalAudioFile).mockReturnValue({ valid: false, reason: 'FLAC 文件头无效' })

    await downloadSingleSong(123456, {
      ...mockConfig,
      target: { kind: 'existing', path: overridePath },
      downloadMode: 'missing',
    })

    expect(getSongUrl).toHaveBeenCalledWith(123456, 'lossless', 'test-cookie')
    expect(downloadSong).toHaveBeenCalledWith(
      'https://example.com/song.flac',
      expect.any(Object),
      'flac',
      expect.any(String),
      expect.any(Object),
      'Old Artist/Old Album (2020)/Test Song.flac',
      undefined,
    )
  })

  it('leaves Local Media Asset persistence to the completion module', async () => {
    const { upsertLocalMediaAsset } = await import('../../server/lib/sync/local-media-store')

    await downloadSingleSong(123456, mockConfig)

    expect(upsertLocalMediaAsset).not.toHaveBeenCalled()
  })

  it('passes lyrics disabled correctly', async () => {
    const configNoLyrics: SingleSongConfig = { ...mockConfig, downloadLyrics: false }

    await downloadSingleSong(123456, configNoLyrics)

    expect(fetchLyric).not.toHaveBeenCalled()
    expect(downloadSong).toHaveBeenCalledWith(
      expect.any(String), expect.any(Object), expect.any(String), expect.any(String),
      expect.objectContaining({ writeLyrics: false }),
      expect.any(String), undefined,
    )
  })

  it('propagates errors from fetchSongDetail', async () => {
    vi.mocked(fetchSongDetail).mockRejectedValue(new Error('API error'))

    await expect(downloadSingleSong(123456, mockConfig)).rejects.toThrow('API error')
    expect(downloadSong).not.toHaveBeenCalled()
  })

  it('propagates errors from getSongUrl', async () => {
    vi.mocked(getSongUrl).mockRejectedValue(new Error('No URL available'))

    await expect(downloadSingleSong(123456, mockConfig)).rejects.toThrow('No URL available')
  })

  it('calls onProgress callback during download', async () => {
    const onProgress = vi.fn()

    await downloadSingleSong(123456, mockConfig, onProgress)

    // downloadSong is called with the onProgress callback
    const downloadCall = vi.mocked(downloadSong).mock.calls[0]!
    expect(downloadCall[6]).toBe(onProgress)
  })

  it('passes metadata options from config', async () => {
    const configWithImages: SingleSongConfig = {
      ...mockConfig,
      saveAlbumCover: true,
      saveArtistImage: true,
    }

    await downloadSingleSong(123456, configWithImages)

    expect(downloadSong).toHaveBeenCalledWith(
      expect.any(String), expect.any(Object), expect.any(String), expect.any(String),
      expect.objectContaining({
        saveAlbumCover: true,
        saveArtistImage: true,
      }),
      expect.any(String), undefined,
    )
  })

  it('constructs SongMeta from Netease data and album detail', async () => {
    await downloadSingleSong(123456, mockConfig)

    const downloadCall = vi.mocked(downloadSong).mock.calls[0]!
    const songMeta = downloadCall[1]

    expect(songMeta.title).toBe('Test Song')
    expect(songMeta.albumArtist).toBe('Artist A')
    expect(songMeta.trackArtist).toBe('Artist B')
    expect(songMeta.album).toBe('Test Album')
    expect(songMeta.trackNumber).toBe(3)
    expect(songMeta.genre).toBe('Pop')
    expect(songMeta.recordLabel).toBe('Test Label')
    expect(songMeta.releaseDate).toBe('2023-11-15')
    expect(songMeta.picUrl).toBe('https://example.com/cover.jpg')
  })

  it('passes romajiLyric when downloadRomajiLyric is enabled', async () => {
    const configWithRomaji: SingleSongConfig = {
      ...mockConfig,
      downloadRomajiLyric: true,
    }

    await downloadSingleSong(123456, configWithRomaji)

    expect(downloadSong).toHaveBeenCalledWith(
      expect.any(String), expect.any(Object), expect.any(String), expect.any(String),
      expect.objectContaining({
        romajiLyric: expect.any(String),
      }),
      expect.any(String), undefined,
    )
  })
})
