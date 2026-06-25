import { candidateNames, resolveArtistCandidates } from './artist-resolver'

export async function resolveSongArtistCandidateNames(
  artists: Array<{ name: string }>,
): Promise<string[]> {
  const names = artists
    .map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name))

  if (names.length === 0) return []

  const seen = new Set<string>()
  const merged: string[] = []

  for (const name of names) {
    const resolved = await resolveArtistCandidates(name)
    for (const candidate of candidateNames(resolved)) {
      const key = candidate.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push(candidate)
    }
  }

  return merged
}
