import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveArtistCandidates = vi.fn()
const candidateNames = vi.fn()

vi.mock('../../server/lib/sync/artist-resolver', () => ({
  resolveArtistCandidates,
  candidateNames,
}))

describe('resolveSongArtistCandidateNames', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('merges candidates from all song artists in order and removes duplicates', async () => {
    resolveArtistCandidates
      .mockResolvedValueOnce({ input: 'Streex' })
      .mockResolvedValueOnce({ input: 'Marshmello' })
    candidateNames
      .mockReturnValueOnce(['Streex', 'Streex Alias'])
      .mockReturnValueOnce(['Marshmello', 'Streex Alias'])

    const { resolveSongArtistCandidateNames } = await import('../../server/lib/sync/song-artist-candidates')
    const result = await resolveSongArtistCandidateNames([
      { name: 'Streex' },
      { name: 'Marshmello' },
    ])

    expect(result).toEqual(['Streex', 'Streex Alias', 'Marshmello'])
  })

  it('ignores empty artist names', async () => {
    const { resolveSongArtistCandidateNames } = await import('../../server/lib/sync/song-artist-candidates')
    const result = await resolveSongArtistCandidateNames([{ name: '   ' }])

    expect(result).toEqual([])
    expect(resolveArtistCandidates).not.toHaveBeenCalled()
  })
})
