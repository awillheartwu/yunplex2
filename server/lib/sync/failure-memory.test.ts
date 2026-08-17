import { describe, expect, it } from 'vitest'

describe('failure memory', () => {
  it('does not pre-skip an explicitly recorded Plex match failure', async () => {
    const { parseFailureMemory, shouldSkipSongDueToFailure, inferFailurePhase } = await import('./failure-memory')
    const memory = parseFailureMemory(JSON.stringify({
      1: { count: 1, lastStatus: 'failed_plex_match', lastPhase: 'plex_match' },
    }))

    expect(inferFailurePhase(1, memory[1])).toBe('plex_match')
    expect(shouldSkipSongDueToFailure(memory, 1, 1)).toBe(false)
  })

  it('still pre-skips true download failures once threshold is reached', async () => {
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
