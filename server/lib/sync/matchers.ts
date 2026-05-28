export function normalizeTitle(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .trim()
}

export function stripPunct(s: string): string {
  return s.toLowerCase().replace(/[/\\:*?"'<>|&\s‘’“”]+/g, '')
}
