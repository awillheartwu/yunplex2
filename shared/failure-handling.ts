/** These are run outcomes; the error code describes the underlying cause. */
export function canRetrySong(status: string): boolean {
  return [
    'failed_download',
    'failed_tags',
    'failed_plex_match',
    'failed_plex_insert',
    'copyright_restricted',
    'ignored_failure',
  ].includes(status)
}

export function canRetryFailure(input: {
  status: string
  sourceId: string | null
  songId: number | null
  downloadTaskIds: readonly string[]
}): boolean {
  return input.status !== 'resolved' && Boolean((input.sourceId && input.songId) || input.downloadTaskIds.length)
}
