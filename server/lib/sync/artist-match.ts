/**
 * Shared artist name comparison utilities.
 *
 * Replaces ad-hoc `toLowerCase().includes()` scattered across
 * fuzzyArtist(), findMatch(), and searchTrack() with a single
 * canonical comparison that all callers share.
 */
import { tify, sify } from 'chinese-conv'

// ── Normalization ──

/**
 * Produce a canonical comparison form of an artist name.
 * - NFC normalisation
 * - lowercase
 * - collapse whitespace
 * - strip decorative punctuation that doesn't affect identity
 */
export function normalizeArtistName(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[''`]/g, "'")
    .trim()
}

// ── Comparison ──

/**
 * Returns true when `plexName` and `candidate` refer to the same artist.
 *
 * Candidates come from the resolver pipeline (original, manual alias,
 * MB alias, script-conversion).  Plex names are whatever the local agent
 * scraped — they may be in a different script, romanised, or slightly
 * mangled by the scanner.
 *
 * Order of checks (cheapest first):
 * 1. exact after normalisation
 * 2. strip punctuation
 * 3. sub-string containment (with length guard for short strings)
 * 4. s2t / t2s round-trip
 */
export function isArtistNameMatch(plexName: string, candidate: string): boolean {
  // Lenient: if either side is empty, assume match (old fuzzyArtist behaviour)
  if (!plexName || !candidate) return true

  const p = normalizeArtistName(plexName)
  const c = normalizeArtistName(candidate)
  if (!p || !c) return true

  // 1) exact match after normalisation
  if (p === c) return true

  // 2) strip punctuation
  const pp = stripArtistPunct(p)
  const cp = stripArtistPunct(c)
  if (pp === cp) return true

  // 3) sub-string containment with length guard
  //    Short names (≤2 chars after strip) are too likely to collide.
  if (cp.length > 2 && pp.length > 2) {
    if (pp.includes(cp) || cp.includes(pp)) return true
  }

  // 4) script conversion (简⇄繁)
  const pt = sify(p) // traditional → simplified
  const ct = sify(c)
  if (pt === ct || stripArtistPunct(pt) === stripArtistPunct(ct)) return true

  const ps = tify(p) // simplified → traditional
  const cs = tify(c)
  if (ps === cs || stripArtistPunct(ps) === stripArtistPunct(cs)) return true

  return false
}

function stripArtistPunct(s: string): string {
  return s
    .replace(/[/\\:*?"'<>|&,，、·.。\-_–—()（）[\]【】「」『』]+/g, '')
    .replace(/\s+/g, '')
}

// ── Batch helpers (used by fuzzyArtist → candidate-list style) ──

/**
 * Returns true when any of the resolution candidates matches `plexName`.
 */
export function anyCandidateMatches(
  plexName: string,
  candidates: Array<{ name: string }>,
): boolean {
  return candidates.some((c) => isArtistNameMatch(plexName, c.name))
}
