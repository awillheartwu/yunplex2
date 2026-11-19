import { describe, it, expect } from 'vitest'
import { normalizeTitle, stripPunct } from '../../server/lib/sync/matchers'
import { buildDownloadPath, sanitizePath } from '../../server/lib/tag-writer'
import { formatTrackArtist, joinList } from '../../server/lib/config/types'
import { coerceValue } from '../../server/lib/db'
import { mergeLyrics } from '../../server/lib/netease'

describe('normalizeTitle', () => {
  it('removes parenthetical content', () => {
    expect(normalizeTitle('Song Title (Remastered 2024)')).toBe('Song Title')
    expect(normalizeTitle('Hello (feat. Someone)')).toBe('Hello')
  })

  it('removes bracketed content', () => {
    expect(normalizeTitle('Track [Live Version]')).toBe('Track')
    expect(normalizeTitle('Song [Bonus Track]')).toBe('Song')
  })

  it('handles empty parentheses', () => {
    expect(normalizeTitle('Song ()')).toBe('Song')
  })

  it('trims whitespace', () => {
    expect(normalizeTitle('  Song  ')).toBe('Song')
    expect(normalizeTitle('\tTrack\n')).toBe('Track')
  })

  it('does not modify text without brackets/parens', () => {
    expect(normalizeTitle('Plain Song Name')).toBe('Plain Song Name')
  })
})

describe('stripPunct', () => {
  it('lowercases and removes ASCII punctuation', () => {
    expect(stripPunct('Hello World')).toBe('helloworld')
    expect(stripPunct("Don't Stop")).toBe('dontstop')
  })

  it('removes smart quotes', () => {
    expect(stripPunct('‘Juno’')).toBe('juno')
    expect(stripPunct('“Abracadabra”')).toBe('abracadabra')
  })

  it('removes slashes, colons, asterisks, ampersands', () => {
    expect(stripPunct('AC/DC')).toBe('acdc')
    expect(stripPunct('Song: Title')).toBe('songtitle')
    expect(stripPunct('Love & Hate')).toBe('lovehate')
  })

  it('removes angle brackets and pipes', () => {
    expect(stripPunct('<One> | Two')).toBe('onetwo')
  })

  it('removes question marks and double quotes', () => {
    expect(stripPunct('What? "Yes"')).toBe('whatyes')
  })
})

describe('buildDownloadPath', () => {
  it('replaces template variables', () => {
    const result = buildDownloadPath(
      '{artist}/{album} ({year})/{title}',
      { artist: 'Radiohead', album: 'OK Computer', year: '1997', title: 'Paranoid Android' },
      'flac',
    )
    expect(result).toContain('Radiohead')
    expect(result).toContain('OK Computer (1997)')
    expect(result).toContain('Paranoid Android.flac')
  })

  it('cleans empty placeholders', () => {
    const result = buildDownloadPath(
      '{artist}/{album} ({year})/{title}',
      { artist: 'Artist', album: 'Album', year: '', title: 'Song' },
      'mp3',
    )
    expect(result).not.toContain('()')
    expect(result).toContain('Artist/Album/Song.mp3')
  })

  it('handles track padding', () => {
    const result = buildDownloadPath(
      '{artist}/{track:02d} - {title}',
      { artist: 'A', 'track:02d': '05', title: 'B', track: '5' },
      'flac',
    )
    expect(result).toContain('05 - B.flac')
  })

  it('joins path segments correctly', () => {
    const result = buildDownloadPath(
      '{artist}/{album}/{title}',
      { artist: 'Artist', album: 'Album', title: 'Song' },
      'flac',
    )
    expect(result).toBe('Artist/Album/Song.flac')
  })
})

describe('sanitizePath', () => {
  it('replaces colon with fullwidth', () => {
    expect(sanitizePath('Title: Subtitle')).not.toContain(':')
    expect(sanitizePath('Title: Subtitle')).toContain('：')
  })

  it('replaces slash and backslash', () => {
    expect(sanitizePath('AC/DC')).not.toContain('/')
    expect(sanitizePath('A\\B')).not.toContain('\\')
  })

  it('replaces question mark and asterisk', () => {
    expect(sanitizePath('What?')).not.toContain('?')
    expect(sanitizePath('Song*')).not.toContain('*')
  })

  it('strips leading/trailing dots and spaces', () => {
    expect(sanitizePath('...song')).toBe('song')
    expect(sanitizePath('song...')).toBe('song')
  })

  it('returns _ for empty result', () => {
    expect(sanitizePath('')).toBe('_')
    expect(sanitizePath('  ..  ')).toBe('_')
  })
})

describe('formatTrackArtist', () => {
  it('handles single artist', () => {
    expect(formatTrackArtist(['Taylor Swift'], 'ampersand')).toBe('Taylor Swift')
  })

  it('formats two artists with feat', () => {
    expect(formatTrackArtist(['A', 'B'], 'feat')).toBe('A feat. B')
  })

  it('formats two artists with ampersand', () => {
    expect(formatTrackArtist(['A', 'B'], 'ampersand')).toBe('A & B')
  })

  it('formats three artists with feat', () => {
    expect(formatTrackArtist(['A', 'B', 'C'], 'feat')).toBe('A feat. B & C')
  })

  it('formats with comma', () => {
    expect(formatTrackArtist(['A', 'B', 'C'], 'comma')).toBe('A, B, C')
  })

  it('formats with slash', () => {
    expect(formatTrackArtist(['A', 'B', 'C'], 'slash')).toBe('A / B / C')
  })

  it('formats with and', () => {
    expect(formatTrackArtist(['A', 'B', 'C'], 'and')).toBe('A, B and C')
  })

  it('formats with ft', () => {
    expect(formatTrackArtist(['A', 'B'], 'ft')).toBe('A ft. B')
  })

  it('formats with plus', () => {
    expect(formatTrackArtist(['A', 'B'], 'plus')).toBe('A + B')
  })
})

describe('joinList', () => {
  it('returns empty for empty array', () => {
    expect(joinList([], ' & ')).toBe('')
  })

  it('returns single name', () => {
    expect(joinList(['A'], ' & ')).toBe('A')
  })

  it('joins two names with conjunction', () => {
    expect(joinList(['A', 'B'], ' & ')).toBe('A & B')
  })

  it('joins three+ names with comma and conjunction', () => {
    expect(joinList(['A', 'B', 'C'], ' & ')).toBe('A, B & C')
    expect(joinList(['A', 'B', 'C', 'D'], ' and ')).toBe('A, B, C and D')
  })
})

describe('coerceValue', () => {
  it('parses port as number', () => {
    expect(coerceValue('port', '8080')).toBe(8080)
  })

  it('parses intervalMinutes as number', () => {
    expect(coerceValue('intervalMinutes', '30')).toBe(30)
  })

  it('parses songLimit as number', () => {
    expect(coerceValue('songLimit', '100')).toBe(100)
  })

  it('returns string for NaN numeric key', () => {
    expect(coerceValue('port', 'abc')).toBe('abc')
  })

  it('parses enabled true', () => {
    expect(coerceValue('enabled', 'true')).toBe(true)
    expect(coerceValue('enabled', '1')).toBe(true)
  })

  it('returns false for non-true enabled', () => {
    expect(coerceValue('enabled', 'false')).toBe(false)
    expect(coerceValue('enabled', '0')).toBe(false)
  })

  it('passes through unknown keys', () => {
    expect(coerceValue('cookie', 'abc123')).toBe('abc123')
  })
})

describe('mergeLyrics', () => {
  const orig = '[00:01.00]Line one\n[00:05.00]Line two'
  const trans = '[00:01.00]第一行\n[00:05.00]第二行'

  it('returns original when no translation', () => {
    expect(mergeLyrics(orig, '', 'original_first')).toBe(orig)
  })

  it('interleaves original_first by default', () => {
    const result = mergeLyrics(orig, trans, 'original_first')
    const lines = result.split('\n').filter(Boolean)
    expect(lines[0]).toBe('[00:01.00]Line one')
    expect(lines[1]).toBe('[00:01.00]第一行')
    expect(lines[2]).toBe('[00:05.00]Line two')
    expect(lines[3]).toBe('[00:05.00]第二行')
  })

  it('interleaves translated_first', () => {
    const result = mergeLyrics(orig, trans, 'translated_first')
    const lines = result.split('\n').filter(Boolean)
    expect(lines[0]).toBe('[00:01.00]第一行')
    expect(lines[1]).toBe('[00:01.00]Line one')
  })

  it('returns original when no matching timestamps', () => {
    const transNoMatch = '[00:99.00]Nothing\n'
    expect(mergeLyrics(orig, transNoMatch, 'original_first')).toBe(orig)
  })
})
