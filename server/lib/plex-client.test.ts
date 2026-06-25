import { describe, expect, it } from 'vitest'
import { buildTitleMatchVariants, titleVariantsMatch } from './plex-client'

describe('plex title matching helpers', () => {
  it('treats simplified and traditional titles as equivalent', () => {
    expect(titleVariantsMatch('难得一遇', '難得一遇')).toBe(true)
  })

  it('preserves remix text when building variants', () => {
    const variants = buildTitleMatchVariants('I See Fire (Kygo Remix)')
    expect(variants.some((value) => value.includes('iseefire'))).toBe(true)
  })

  it('does not treat cover and original titles as equivalent', () => {
    expect(titleVariantsMatch('Middle (DJ Snake Cover)', 'Middle')).toBe(false)
  })
})
