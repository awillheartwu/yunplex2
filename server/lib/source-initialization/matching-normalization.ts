import { artistMatchingKey, matchingKey } from '../../../shared/initialization-matching-text'
export { matchingKey } from '../../../shared/initialization-matching-text'
import { supplementalTitleKeys } from './supplemental-recall'
import type { InitializationMatchingConfig, MatchingAlias } from '../../../shared/initialization-matching'

const VERSION_PATTERN = /\b(?:instrumental|karaoke|acoustic|live|demo|cover|remix|remaster(?:ed)?|radio edit|album version|single version|original mix|album mix|radio mix|lp version|standard version|tv size|vocal mix|sing along|explicit|clean|piano|sped up|slowed|mandarin|cantonese|japanese|english|korean)\b|カラオケ|インストゥルメンタル|TVサイズ|独唱版|合唱版|朗诵版|吉他版|伴奏|纯音乐|现场|翻唱|混音|重制|母带|不插电|钢琴|国语|粤语|日语|英语|韩语/iu
const BRACKETS = /[（([【]([^）)\]】]+)[）)\]】]/gu

export interface TitleParts { core: string; variants: string[]; versions: Record<string, string>; contextRemoved: boolean; supplemental: string[]; contributors: string[] }
export function titleParts(title: string, config: InitializationMatchingConfig): TitleParts {
  const versions: Record<string, string> = {}
  let contextRemoved = false
  const contributors: string[] = []
  const version = (content: string): boolean => {
    const text = content.toLowerCase().trim()
    if (!VERSION_PATTERN.test(text)) return false
    const rules: Array<[string, RegExp]> = [
      ['instrumental', /\binstrumental\b|\bkaraoke\b|カラオケ|インストゥルメンタル|伴奏|纯音乐/iu],
      ['live', /\blive\b|现场/iu], ['cover', /\bcover\b|翻唱/iu],
      ['remix', /\bremix\b|混音/iu], ['demo', /\bdemo\b/iu],
      ['acoustic', /\bacoustic\b|不插电/iu], ['piano', /\bpiano\b|钢琴/iu],
      ['speed', /\bsped up\b|\bslowed\b/iu],
      ['language', /\b(?:mandarin|cantonese|japanese|english|korean)\b|国语|粤语|日语|英语|韩语/iu],
      ['remaster', /\bremaster(?:ed)?\b|重制|母带/iu],
      ['edition', /\b(?:radio edit|album version|single version|original mix|album mix|radio mix|lp version|standard version|tv size)\b|TVサイズ/iu],
      ['arrangement', /\b(?:sing along|vocal mix)\b|独唱版|合唱版|朗诵版|吉他版/iu],
      ['explicit', /\b(?:explicit|clean)\b/iu],
    ]
    for (const [key, pattern] of rules) if (pattern.test(text)) {
      // Preserve authors, years and edition details, not merely the word "remix".
      versions[key] = matchingKey(text, config)
    }
    return true
  }
  let core = title.replace(BRACKETS, (_all, content: string) => {
    if (version(content)) return ' '
    const credit = content.trim().match(/^(?:(?:feat(?:uring)?|ft|with)\.?\s+|vocals?\s*[:：]\s*)(.+)$/iu)
    if (credit) { contributors.push(credit[1]!.trim()); return ' ' }
    if (config.ignoreContextNotes && /^(?:from\s|prod(?:uced)?[.\s]|original (?:motion picture|television) soundtrack|bonus track|附赠曲|电影.*(?:主题|插)曲)/iu.test(content.trim())) {
      contextRemoved = true
      return ' '
    }
    return ` ${content} `
  })
  // Japanese tags often wrap versions in waves or unspaced hyphens.
  // Only treat a paired trailing annotation as a version, never title words alone.
  core = core.replace(/\s*([-~〜～–—])\s*([^~〜～–—]+?)\s*\1\s*$/u, (all, _delimiter: string, content: string) => version(content) ? ' ' : all)
  core = core.replace(/\s+[-–—]\s+(.+)$/u, (all, content: string) => version(content) ? ' ' : all)
  const normalized = matchingKey(core, config)
  const literal = !normalized && /^[\p{P}\p{S}\s]+$/u.test(title) ? `literal:${title.normalize('NFKC').trim()}` : ''
  const variants = [normalized || literal]
  if (config.bilingualTitles) {
    const bilingual = core.match(/^([\p{Script=Han}\s]+)\s+([A-Za-z][\s\S]+)$/u)
    if (bilingual) variants.push(matchingKey(bilingual[1]!, config))
  }
  return { core: variants[0]!, variants: [...new Set(variants.filter(Boolean))], versions, contextRemoved, supplemental: config.supplementalTitleRecall ? supplementalTitleKeys(title, config) : [], contributors }
}

export function aliasKeys(value: string, groups: MatchingAlias[], config: InitializationMatchingConfig, artist = false): Set<string> {
  const normalize = artist ? artistMatchingKey : matchingKey
  const key = normalize(value, config)
  const result = new Set([key].filter(Boolean))
  for (const group of groups) {
    if (!group.enabled) continue
    const keys = [group.name, ...group.aliases].map(name => normalize(name, config))
    if (keys.includes(key)) keys.forEach(name => result.add(name))
  }
  return result
}

export function versionEvidence(left: TitleParts, right: TitleParts, config: InitializationMatchingConfig): { conflicts: string[]; review: string[]; excluded: boolean } {
  const conflicts: string[] = [], review: string[] = []
  let excluded = false
  for (const key of new Set([...Object.keys(left.versions), ...Object.keys(right.versions)])) {
    const a = left.versions[key], b = right.versions[key]
    if (a === b) continue
    const label = ({ instrumental: '伴奏', live: '现场', cover: '翻唱', remix: '混音', demo: 'Demo', acoustic: '不插电', piano: '钢琴', speed: '变速', language: '语言', arrangement: '演唱或编曲', remaster: '重制', edition: '发行版本', explicit: 'Explicit / Clean' } as Record<string, string>)[key] || key
    const policy = key === 'remaster' ? config.remasterPolicy : key === 'edition' ? config.editionPolicy : key === 'explicit' ? config.explicitPolicy : null
    if ((!a || !b) && config.unknownVersion === 'exclude') excluded = true
    if (policy === 'allow') continue
    if (policy === 'review') review.push(`${label}信息不同，需确认`)
    else conflicts.push(`${label}版本${a && b ? '不同' : '信息仅存在于一侧'}`)
  }
  if (conflicts.length && !config.showVersionConflicts) excluded = true
  return { conflicts, review, excluded }
}
