import { describe, expect, it } from 'vitest'
import { collectArtistNames, nextArtistWriteOrder, projectArtistNames } from '~~/shared/artist-names'

describe('unified artist names preserves runtime contracts', () => {
  it('round trips disabled matching and directed writes including precedence', () => {
    const matching = [{ name: 'A', aliases: ['B'], enabled: false }, { name: 'X', aliases: ['Y'], enabled: true }]
    const replacements = { B: 'A', ' B ': 'C', Y: 'X', A: 'B', Z: 'A' }
    const output = projectArtistNames(collectArtistNames(matching, replacements))
    expect(output.matching).toEqual(matching)
    expect(Object.entries(output.replacements)).toEqual(Object.entries(replacements))
  })
  it('does not infer equivalence from cross-group or ambiguous writes', () => {
    const matching = [{ name: 'A', aliases: ['B'], enabled: true }, { name: 'B', aliases: ['A'], enabled: false }]
    const groups = collectArtistNames(matching, { A: 'B', X: 'A' })
    expect(groups.slice(0, 2).every(group => !group.writes.length)).toBe(true)
    expect(groups.slice(2).every(group => !group.matchingEnabled && !group.matchingStored)).toBe(true)
    expect(projectArtistNames(groups).matching).toEqual(matching)
  })
  it('name edits never change or create write directions', () => {
    const groups = collectArtistNames([{ name: 'A', aliases: ['B'], enabled: true }], { B: 'A' })
    groups[0]!.name = 'C'
    groups[0]!.aliases.push('D')
    expect(projectArtistNames(groups).replacements).toEqual({ B: 'A' })
    groups[0]!.writes.push({ source: 'D', target: 'E', order: nextArtistWriteOrder(groups) })
    expect(projectArtistNames(groups).replacements).toEqual({ B: 'A', D: 'E' })
  })
  it('rejects incomplete edits and duplicate write sources', () => {
    const groups = collectArtistNames([], { A: 'B' })
    groups[0]!.writes.push({ source: 'C', target: '', order: 1 })
    expect(() => projectArtistNames(groups)).toThrow('需要填写')
    Object.assign(groups[0]!.writes[1]!, { source: 'A', target: 'C' })
    expect(() => projectArtistNames(groups)).toThrow('重复')
  })
  it('preserves legacy empty values and special object keys', () => {
    const replacements = JSON.parse('{"__proto__":"Artist","":""," constructor ":"Other"}')
    const result = projectArtistNames(collectArtistNames([], replacements))
    expect(Object.entries(result.replacements)).toEqual(Object.entries(replacements))
    expect(result.matching).toEqual([])
  })
})
