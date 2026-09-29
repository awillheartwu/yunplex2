import type { InitializationMatchingConfig } from '../../../shared/initialization-matching'
import { matchingKey } from '../../../shared/initialization-matching-text'

/** Retrieval keys only. None of these transformations proves title identity. */
export function supplementalTitleKeys(title: string, config: InitializationMatchingConfig): string[] {
  const bare = title.replace(/[（([【]([^）)\]】]*)[）)\]】]/gu, ' ').trim()
  const variants = [bare, title.replace(/^\s*(?:\d{1,3}[.．、\s-]+|[A-D]\d{1,2}\s+)/u, '')]
  const coreNumbers = bare.replace(/[零〇一二三四五六七八九]/gu, digit => String('零一二三四五六七八九'.indexOf(digit === '〇' ? '零' : digit)))
  variants.push(coreNumbers)
  // Preserve the complete title as primary evidence; inspect separated bilingual
  // names only for recall. Never split same-script medleys into individual songs.
  for (const part of title.split(/\s*[/／|｜]\s*/u)) {
    if (/[\p{Script=Han}]/u.test(title) && /[A-Za-z]/u.test(title)) variants.push(part)
  }
  const bilingual = bare.match(/^([A-Za-z][A-Za-z\s'’‐-]+)\s+([\p{Script=Han}]+)$/u)
  if (bilingual) variants.push(bilingual[1]!, bilingual[2]!)
  return [...new Set(variants.map(value => matchingKey(value, config)).filter(Boolean))]
}

/** A work number without a movement must never equate all movements/performers. */
export function classicalWorkKey(title: string): string | null {
  const catalog = title.match(/\b(BWV|K[V]?|HWV|D|RV|Op)\.?\s*(\d+[a-z]?)/iu)
  if (!catalog) return null
  const tail = title.slice((catalog.index ?? 0) + catalog[0].length)
  const movement = tail.match(/^\s*[:：/.–-]\s*([IVX]+|\d+)\s*[.．:]?/iu)
  const prelude = /pr[ée]lude|前奏曲/iu.test(title)
  if (!movement && !prelude) return null
  return `${catalog[1]!.toUpperCase()}:${catalog[2]!.toLowerCase()}:${movement?.[1]?.toUpperCase() ?? 'I'}:${prelude ? 'prelude' : ''}`
}

export function closeSpelling(left: string, right: string): boolean {
  // Only called after independent artist and duration constraints; short names
  // need album/track evidence instead of fuzzy edit-distance matching.
  const a = [...left], b = [...right]
  if (a.length < 5 || b.length < 5) return false
  const limit = Math.min(4, Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.25)))
  if (Math.abs(a.length - b.length) > limit) return false
  let previous = b.map((_, index) => index + 1)
  previous.unshift(0)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + Number(a[i - 1] !== b[j - 1]))
    if (Math.min(...row) > limit) return false
    previous = row
  }
  return previous[b.length]! <= limit
}
