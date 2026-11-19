import type { InitializationMatchingConfig } from '../../../shared/initialization-matching'
import { artistMatchingKey as matchingKey } from '../../../shared/initialization-matching-text'

/** Parse explicit credit separators while preserving whole, known band names. */
export function artistCreditKeys(values: string[], known: Set<string>[], config: InitializationMatchingConfig): string[] {
  const keys = new Set<string>()
  const recognized = new Set(known.flatMap(group => [...group]))
  for (const value of values) {
    const whole = matchingKey(value, config)
    if (recognized.has(whole)) { keys.add(whole); continue }
    // Colon credits are split only when every participant is independently known.
    const project = value.split(/[:：]/u).map(part => matchingKey(part, config))
    if (project.length > 1 && project.every(key => recognized.has(key))) { project.forEach(key => keys.add(key)); continue }
    const separators = [...value.matchAll(/\s*(?:&|\/|、|,|，|\+|;|；|\b(?:feat(?:uring)?|ft|with|and|as)\.?\b|\bw\.\s)\s*/giu)]
    const starts = [0, ...separators.map(match => match.index! + match[0].length)]
    const ends = [...separators.map(match => match.index!), value.length]
    for (let i = 0; i < starts.length;) {
      let end = i
      // Rejoin original text, not concatenated fragments: "Moments With You"
      // must retain "With", and "Florence + The Machine" must retain its name.
      for (let j = ends.length - 1; j > i; j--) {
        if (recognized.has(matchingKey(value.slice(starts[i], ends[j]), config))) { end = j; break }
      }
      const key = matchingKey(value.slice(starts[i], ends[end]), config)
      if (key) keys.add(key)
      i = end + 1
    }
  }
  return [...keys]
}
