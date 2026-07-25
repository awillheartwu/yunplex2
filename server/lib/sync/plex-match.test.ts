import { describe, expect, it } from 'vitest'
import { describePlexMatchFailure, inferPlexMatchFailureCause } from './plex-match'

describe('plex match failure diagnostics', () => {
  const cfg = {
    download: {
      dir: '/Users/wuhaoli/projects/test',
      plexLibraryPathPrefix: '/volume1/06_Music',
    },
  } as any

  it('classifies all-downloaded-all-unmatched batches as library visibility issues', () => {
    const cause = inferPlexMatchFailureCause(
      {
        ratingKey: null,
        matchedBy: null,
        attempts: 6,
        localFilePath: '/Users/wuhaoli/projects/test/foo.flac',
        traces: [],
      },
      { downloadedSongs: 15, failedDownloadedSongs: 15 },
    )

    expect(cause).toBe('library_visibility')
    expect(describePlexMatchFailure(cause, cfg)).toContain('/Users/wuhaoli/projects/test')
  })

  it('classifies every exact local-path miss as a Plex visibility/publication problem', () => {
    const cause = inferPlexMatchFailureCause(
      {
        ratingKey: null,
        matchedBy: null,
        attempts: 6,
        localFilePath: '/Users/wuhaoli/projects/test/foo.flac',
        traces: [],
      },
      { downloadedSongs: 3, failedDownloadedSongs: 1 },
    )

    expect(cause).toBe('library_visibility')
  })
})
