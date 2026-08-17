import { describe, expect, it } from 'vitest'
import {
  albumsMatchConservatively,
  normalizeTitle,
  titleCoresEqual,
  titleIdentityDescriptorsCompatible,
  titlesMatchConservatively,
} from '../../server/lib/sync/matchers'

describe('conservative title identity', () => {
  it('matches exact and punctuation-only variants', () => {
    expect(titlesMatchConservatively('Hello World', 'Hello World')).toBe(true)
    expect(titlesMatchConservatively('Dont Stop', "Don't Stop")).toBe(true)
  })

  it('preserves non-version bracket content as identity', () => {
    expect(normalizeTitle('III (Find Yourself)')).toBe('III Find Yourself')
    expect(titlesMatchConservatively('III', 'III (Find Yourself)')).toBe(false)
    expect(titlesMatchConservatively('Song (Part 1)', 'Song (Part 2)')).toBe(false)
  })

  it('requires version descriptor sets to match exactly', () => {
    expect(titleIdentityDescriptorsCompatible('Song (Live Remix)', 'Song (Live Acoustic)')).toBe(false)
    expect(titleIdentityDescriptorsCompatible('Song (Live Remix)', 'Song [Live Remix]')).toBe(true)
    expect(titlesMatchConservatively('Song', 'Song (Remastered 2024)')).toBe(false)
    expect(titlesMatchConservatively('Song (Remastered 2024)', 'Song (Deluxe)')).toBe(false)
  })

  it('allows weak candidate discovery without treating it as an identity match', () => {
    expect(titleCoresEqual('Middle', 'Middle (DJ Snake Cover)')).toBe(true)
    expect(titlesMatchConservatively('Middle', 'Middle (DJ Snake Cover)')).toBe(false)
  })

  it('rejects empty and unrelated titles', () => {
    expect(titlesMatchConservatively('', 'Something')).toBe(false)
    expect(titlesMatchConservatively('Hello', 'Goodbye')).toBe(false)
  })
})

describe('conservative album identity', () => {
  it('matches punctuation-only variants', () => {
    expect(albumsMatchConservatively('OK Computer', 'OKComputer')).toBe(true)
  })

  it('does not use substring containment', () => {
    expect(albumsMatchConservatively('The Dark Side of the Moon', 'Dark Side')).toBe(false)
    expect(albumsMatchConservatively('Dark Side', 'The Dark Side of the Moon')).toBe(false)
  })

  it('treats missing album metadata as unknown rather than conflicting', () => {
    expect(albumsMatchConservatively('', 'Anything')).toBe(true)
    expect(albumsMatchConservatively('Anything', '')).toBe(true)
  })
})
