import { formatTrackArtist } from '../config/types'
import type { MultiArtistFormat } from '../config/types'

/**
 * Returns a function that splits an array of Netease artists into
 * [albumArtist, trackArtist].
 * - albumArtist: always the first artist only (for Plex library organization)
 * - trackArtist: empty for single artist, formatted for collaborations
 */
export function createSplitArtists(multiFormat: MultiArtistFormat) {
  return (artists: { name: string }[]): [string, string] => {
    if (artists.length === 0) return ['', '']
    const albumArtist = artists[0]!.name
    if (artists.length === 1) return [albumArtist, '']
    const trackArtist = formatTrackArtist(artists.map((a) => a.name), multiFormat)
    return [albumArtist, trackArtist]
  }
}

/** Legacy helper — still used for display/log messages */
export function joinArtist(artists: { name: string }[]): string {
  return artists.length === 0 ? '' : artists[0]!.name
}
