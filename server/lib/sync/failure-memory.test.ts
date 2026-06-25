import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSongLookup = vi.fn()

vi.mock('./song-lookup-store', () => ({
  getSongLookup,
}))

describe('failure memory', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('does not pre-skip legacy Plex match failures that only have a local file path', async () => {
    getSongLookup.mockReturnValue({
      netease_song_id: 1,
      plex_rating_key: null,
      file_path: '/downloads/foo.flac',
      last_verified_at: '2026-06-19T00:00:00.000Z',
    })

    const { parseFailureMemory, shouldSkipSongDueToFailure, inferFailurePhase } = await import('./failure-memory')
    const memory = parseFailureMemory(JSON.stringify({ 1: 1 }))

    expect(inferFailurePhase(1, memory[1])).toBe('plex_match')
    expect(shouldSkipSongDueToFailure(memory, 1, 1)).toBe(false)
  })

  it('still pre-skips true download failures once threshold is reached', async () => {
    getSongLookup.mockReturnValue(undefined)

    const { parseFailureMemory, shouldSkipSongDueToFailure } = await import('./failure-memory')
    const memory = parseFailureMemory(JSON.stringify({
      2: { count: 2, lastStatus: 'failed_download', lastPhase: 'download' },
    }))

    expect(shouldSkipSongDueToFailure(memory, 2, 2)).toBe(true)
  })

  it('round-trips structured entries when serializing', async () => {
    const { parseFailureMemory, recordFailure, serializeFailureMemory } = await import('./failure-memory')

    const next = recordFailure({}, 9, {
      status: 'failed_plex_match',
      phase: 'plex_match',
      message: 'Plex 未识别到歌曲',
      suspectedCause: 'library_visibility',
    })

    const reparsed = parseFailureMemory(serializeFailureMemory(next))
    expect(reparsed[9]).toMatchObject({
      count: 1,
      lastStatus: 'failed_plex_match',
      lastPhase: 'plex_match',
      suspectedCause: 'library_visibility',
    })
  })
})
