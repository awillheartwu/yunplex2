import { sify } from 'chinese-conv'
import type { InitializationMatchingConfig } from './initialization-matching'

/** Shared by candidate comparisons and alias collision validation. */
export function matchingKey(value: string, config: Pick<InitializationMatchingConfig, 'normalizeTypography' | 'foldChinese'>): string {
  let text = value.normalize(config.normalizeTypography ? 'NFKC' : 'NFC').toLowerCase().trim()
  if (config.foldChinese) text = sify(text)
  return config.normalizeTypography ? text.replace(/[\p{P}\p{S}\s]+/gu, '') : text.replace(/\s+/g, ' ')
}

/** Accent folding is opt-in and confined to artist identities, not titles. */
export function artistMatchingKey(value: string, config: Pick<InitializationMatchingConfig, 'normalizeTypography' | 'foldChinese'> & { foldArtistDiacritics?: boolean }): string {
  const text = config.foldArtistDiacritics
    ? value.normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC') : value
  return matchingKey(text, config)
}
