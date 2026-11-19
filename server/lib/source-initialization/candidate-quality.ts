import type { PlexTrack } from '../plex-client'

/** Quality is a user preference among eligible recordings, not identity evidence. */
export function candidateQuality(track: PlexTrack): number[] {
  const media = track.Media?.find(item => item.Part?.some(part => part.file))
  const codec = media?.audioCodec?.toLowerCase() || ''
  const file = media?.Part?.[0]?.file || ''
  const lossless = /^(flac|alac|pcm.*|wav|aiff|ape|wavpack)$/.test(codec)
    || (!codec && /\.(flac|alac|wav|aiff|ape|wv)$/i.test(file))
  const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0
  return [Number(lossless), lossless ? positive(media?.audioBitDepth) : 0,
    lossless ? positive(media?.audioSampleRate) : 0, positive(media?.bitrate)]
}

export function compareCandidateQuality(a: PlexTrack, b: PlexTrack): number {
  const left = candidateQuality(a), right = candidateQuality(b)
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return right[i]! - left[i]!
  // Stable preference when quality metadata is identical or unavailable.
  return String(a.ratingKey).localeCompare(String(b.ratingKey), 'en', { numeric: true })
}
