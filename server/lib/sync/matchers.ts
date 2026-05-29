import { tify } from 'chinese-conv'

export function normalizeTitle(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .trim()
}

export function stripPunct(s: string): string {
  return s.toLowerCase().replace(/[/\\:*?"'<>|&\s'""‘’“”]+/g, '')
}

/** Simplified → Traditional Chinese conversion via chinese-conv. */
export function s2t(text: string): string {
  return tify(text)
}
