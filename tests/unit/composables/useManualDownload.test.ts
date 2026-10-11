import { describe, expect, it } from 'vitest'
import {
  isManualMultiSongInput,
  matchManualDownloadUrl,
  parseManualSongIds,
} from '~~/composables/useManualDownload'

describe('manual download input helpers', () => {
  it('detects supported Netease resource URLs', () => {
    expect(matchManualDownloadUrl('https://music.163.com/#/playlist?id=123456')).toEqual({ type: 'playlist', id: 123456 })
    expect(matchManualDownloadUrl('https://music.163.com/album?id=234567')).toEqual({ type: 'album', id: 234567 })
    expect(matchManualDownloadUrl('https://music.163.com/#/song?id=345678')).toEqual({ type: 'songs', id: 345678 })
  })

  it('returns null for unsupported URLs', () => {
    expect(matchManualDownloadUrl('https://example.com/song?id=1')).toBeNull()
    expect(matchManualDownloadUrl('not a url')).toBeNull()
  })

  it('parses newline comma and semicolon separated song ids', () => {
    expect(parseManualSongIds('100\n200, 300;400')).toEqual([100, 200, 300, 400])
  })

  it('requires every token to be numeric for multi-song input detection', () => {
    expect(isManualMultiSongInput('100\n200')).toBe(true)
    expect(isManualMultiSongInput('100, 200;300')).toBe(true)
    expect(isManualMultiSongInput('100\nabc')).toBe(false)
    expect(isManualMultiSongInput('100')).toBe(false)
  })
})
