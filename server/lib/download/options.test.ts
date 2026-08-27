import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config/defaults'
import { resolveSingleSongConfig } from './options'

describe('resolveSingleSongConfig', () => {
  it('concentrates application defaults into a complete download configuration', () => {
    const resolved = resolveSingleSongConfig(DEFAULT_CONFIG)

    expect(resolved).toMatchObject({
      quality: DEFAULT_CONFIG.netease.quality,
      cookie: DEFAULT_CONFIG.netease.cookie,
      downloadDir: DEFAULT_CONFIG.download.dir,
      pathFormat: DEFAULT_CONFIG.other.pathFormat,
      multiArtistFormat: DEFAULT_CONFIG.other.multiArtistFormat,
    })
    expect(resolved).not.toHaveProperty('downloadMode')
  })

  it('applies only explicit operation overrides', () => {
    const resolved = resolveSingleSongConfig(DEFAULT_CONFIG, {
      quality: 'hires',
      downloadLyrics: false,
      downloadMode: 'missing',
      embedMetadata: true,
      embedCover: false,
      target: { kind: 'existing', path: '/music/song.flac' },
    })

    expect(resolved).toMatchObject({
      quality: 'hires',
      downloadLyrics: false,
      downloadMode: 'missing',
      embedMetadata: true,
      embedCover: false,
      target: { kind: 'existing', path: '/music/song.flac' },
    })
    expect(resolved.downloadLyrics).toBe(false)
    expect(resolved.saveAlbumCover).toBe(DEFAULT_CONFIG.download.saveAlbumCover)
  })
})
