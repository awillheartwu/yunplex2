import { tify } from 'chinese-conv'

export function normalizeTitle(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .trim()
}

export function stripPunct(s: string): string {
  return s.toLowerCase().replace(/[/\\:*?"'<>|&\s'""''""]+/g, '')
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
    .replace(/[/\\:*?"'<>|&'""''!@#$%^&*+=~.,;:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function s2t(text: string): string {
  return tify(text)
}
