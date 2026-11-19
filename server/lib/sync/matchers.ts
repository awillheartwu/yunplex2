import { sify, tify } from 'chinese-conv'

const TITLE_IDENTITY_DESCRIPTOR_RULES: Array<{ key: string; pattern: RegExp }> = [
  { key: 'cover', pattern: /\bcover\b|翻唱/u },
  { key: 'remix', pattern: /\bremix\b|混音/u },
  { key: 'remake', pattern: /\bremake\b|重制/u },
  { key: 'instrumental', pattern: /\binstrumental\b|伴奏|纯音乐/u },
  { key: 'acoustic', pattern: /\bacoustic\b|不插电/u },
  { key: 'live', pattern: /\blive\b|现场/u },
  { key: 'demo', pattern: /\bdemo\b/u },
  { key: 'karaoke', pattern: /\bkaraoke\b/u },
  { key: 'edit', pattern: /\b(edit|radio edit)\b/u },
  { key: 'rework', pattern: /\b(rework|bootleg|mashup)\b/u },
  { key: 'piano', pattern: /\bpiano\b|钢琴/u },
  { key: 'remaster', pattern: /\bremaster(?:ed)?\b|母带|重灌/u },
  { key: 'deluxe', pattern: /\bdeluxe\b|豪华版/u },
]

export function normalizeTitle(title: string): string {
  return title
    .replace(/[（(【[]\s*[）)】\]]/gu, ' ')
    .replace(/[（(【[]([^）)】\]]+)[）)】\]]/gu, (_match, rawContent: string) => {
      const content = normalizeForSearch(rawContent)
      const isIdentityDescriptor = TITLE_IDENTITY_DESCRIPTOR_RULES.some(rule => rule.pattern.test(content.toLowerCase()))
      const isNonIdentityDetail = /\bfeat(?:uring)?\.?\b|\bft\.?\b|\bbonus(?: track)?\b|附赠曲/iu.test(content)
      return isIdentityDescriptor || isNonIdentityDetail ? ' ' : ` ${content} `
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export function stripPunct(s: string): string {
  return s.toLowerCase().replace(/[/\\:*?"'<>|&\s‘’“”]+/g, '')
}

/**
 * Aggressively normalize a title/artist string for Plex search queries.
 * Strips all bracket variants (Western, Chinese), punctuation, smart quotes,
 * then collapses whitespace. Safe for any language.
 */
export function normalizeForSearch(text: string): string {
  return text
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/[【〔《「『〈][^】〕》」』〉]*[】〕》」』〉]/g, ' ')
    .replace(/[/\\:*?"'<>|&‘’“”!@#$%^&*+=~.,;:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function s2t(text: string): string {
  return tify(text)
}

export function t2s(text: string): string {
  return sify(text)
}

function extractBracketContents(title: string): string[] {
  const matches = [...title.matchAll(/[（(【[]([^）)】\]]+)[）)】\]]/gu)]
  return matches
    .map((match) => normalizeForSearch(match[1] ?? '').toLowerCase())
    .filter(Boolean)
}

export function extractTitleIdentityDescriptors(title: string): string[] {
  const descriptors = new Set<string>()
  for (const content of extractBracketContents(title)) {
    for (const rule of TITLE_IDENTITY_DESCRIPTOR_RULES) {
      if (rule.pattern.test(content)) descriptors.add(rule.key)
    }
  }
  return [...descriptors]
}

export function titleIdentityDescriptorsCompatible(left: string, right: string): boolean {
  const leftDescriptors = extractTitleIdentityDescriptors(left)
  const rightDescriptors = extractTitleIdentityDescriptors(right)

  if (leftDescriptors.length === 0 && rightDescriptors.length === 0) return true
  if (leftDescriptors.length === 0 || rightDescriptors.length === 0) return false

  if (leftDescriptors.length !== rightDescriptors.length) return false
  const rightSet = new Set(rightDescriptors)
  return leftDescriptors.every(descriptor => rightSet.has(descriptor))
}

export function titlesMatchConservatively(left: string, right: string): boolean {
  if (!titleIdentityDescriptorsCompatible(left, right)) return false
  const leftKey = stripPunct(normalizeTitle(left))
  const rightKey = stripPunct(normalizeTitle(right))
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}

export function titleCoresEqual(left: string, right: string): boolean {
  const leftKey = stripPunct(normalizeTitle(left))
  const rightKey = stripPunct(normalizeTitle(right))
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}

export function albumsMatchConservatively(left: string, right: string): boolean {
  if (!left || !right) return true
  const leftKey = stripPunct(normalizeTitle(left))
  const rightKey = stripPunct(normalizeTitle(right))
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}
