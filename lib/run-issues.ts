import type { RunIssueCounts, SongStatus } from '../server/lib/job/types'

export function summarizeRunIssues(songs: readonly { id: string; status: SongStatus; sourceId?: string; neteaseSongId?: number }[]): RunIssueCounts {
  const groups = { deferred: new Set<string>(), ignored: new Set<string>(), manual: new Set<string>(), preserved: new Set<string>(), restricted: new Set<string>() }
  const kinds: Partial<Record<SongStatus, keyof RunIssueCounts>> = {
    awaiting_retry: 'deferred', ignored_failure: 'ignored', awaiting_manual_match: 'manual',
    extra_skipped: 'preserved', copyright_restricted: 'restricted',
  }
  for (const song of songs) {
    const group = kinds[song.status]
    if (group) groups[group].add(`${song.sourceId ?? ''}:${song.neteaseSongId ?? song.id}`)
  }
  return { deferred: groups.deferred.size, ignored: groups.ignored.size, manual: groups.manual.size,
    preserved: groups.preserved.size, restricted: groups.restricted.size }
}
