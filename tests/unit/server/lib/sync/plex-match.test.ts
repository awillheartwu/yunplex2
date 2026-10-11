import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { describePlexMatchFailure, inferPlexMatchFailureCause } from '~~/server/lib/sync/plex-match'

describe('plex match failure diagnostics', () => {
  const cfg = {
    ...DEFAULT_CONFIG,
    download: {
      ...DEFAULT_CONFIG.download,
      dir: '/music/downloads',
      plexLibraryPathPrefix: '/music',
    },
  }

  it('classifies all-downloaded-all-unmatched batches as library visibility issues', () => {
    const cause = inferPlexMatchFailureCause(
      {
        ratingKey: null,
        matchedBy: null,
        attempts: 6,
        localFilePath: '/music/downloads/foo.flac',
        traces: [],
      },
    )

    expect(cause).toBe('library_visibility')
    expect(describePlexMatchFailure(cause, cfg)).toContain('/music/downloads')
  })

  it('classifies every exact local-path miss as a Plex visibility/publication problem', () => {
    const cause = inferPlexMatchFailureCause(
      {
        ratingKey: null,
        matchedBy: null,
        attempts: 6,
        localFilePath: '/music/downloads/foo.flac',
        traces: [],
      },
    )

    expect(cause).toBe('library_visibility')
  })
})
