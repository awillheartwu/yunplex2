import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '../../server/lib/db'
import { createSource } from '../../server/lib/playlist/store'

vi.mock('../../server/lib/plex-client', () => ({
  insertTracksIntoPlaylist: vi.fn(),
  playlistInsertBatches: (keys: readonly string[]) => keys.length ? [[...keys]] : [],
  movePlaylistItemAfter: vi.fn(),
  movePlaylistItemToTop: vi.fn(),
  removeTrackFromPlaylist: vi.fn(),
  getPlaylistWriteTracks: vi.fn(),
}))

import { applyFullReorder as applyReorder, computeLCS, PlexReorderError, validatePlaylistOrder, type PlexItem } from '../../server/lib/sync/reorder'
import {
  getPlaylistWriteTracks,
  insertTracksIntoPlaylist,
  movePlaylistItemAfter,
  movePlaylistItemToTop,
  removeTrackFromPlaylist,
} from '../../server/lib/plex-client'

let directory: string
let sourceId: string
let playlist: PlexItem[]
let nextItemId: number

function applyFullReorder(...args: Parameters<typeof applyReorder>) {
  playlist = args[2].map(item => ({ ...item }))
  nextItemId = Math.max(0, ...playlist.map(item => item.playlistItemId)) + 1
  const [key, target, current, section, cancelled, log, options] = args
  return applyReorder(key, target, current, section, cancelled, log,
    { ...options, owner: { sourceId, scope: 'fixture-server', assertCurrent: () => undefined } })
}

function move(id: number, anchor: number | null) {
  const index = playlist.findIndex(item => item.playlistItemId === id)
  const [item] = playlist.splice(index, 1)
  playlist.splice(anchor === null ? 0 : playlist.findIndex(item => item.playlistItemId === anchor) + 1, 0, item!)
}

beforeEach(async () => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'reyunplex-reorder-boundary-'))
  initDb(directory)
  sourceId = (await createSource(1, '', { name: 'Fixture source' })).id
  playlist = []
  nextItemId = 1
  vi.mocked(getPlaylistWriteTracks).mockImplementation(async () => playlist.map(item => ({
    ratingKey: item.ratingKey, playlistItemID: item.playlistItemId,
    title: item.ratingKey, grandparentTitle: '', parentTitle: '',
  })))
  vi.mocked(insertTracksIntoPlaylist).mockImplementation(async (_key, keys) => {
    for (const ratingKey of keys) playlist.push({ ratingKey, playlistItemId: nextItemId++ })
  })
  vi.mocked(movePlaylistItemToTop).mockImplementation(async (_key, id) => { move(id, null) })
  vi.mocked(movePlaylistItemAfter).mockImplementation(async (_key, id, anchor) => { move(id, anchor) })
  vi.mocked(removeTrackFromPlaylist).mockImplementation(async (_key, id) => {
    playlist = playlist.filter(item => item.playlistItemId !== id)
  })
})

afterEach(() => { closeDb(); rmSync(directory, { recursive: true, force: true }) })

describe('validatePlaylistOrder', () => {
  it('passes when target tracks are present in order and no extras are disallowed', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(true)
  })

  it('fails when a target track is missing', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'a' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['b'])
  })

  it('fails when target tracks are out of order', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'b' }, { ratingKey: 'a' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.currentTargetOrder).toEqual(['b', 'a'])
  })

  it('allows extra tracks when removal is disabled', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'x' }, { ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: true },
    )

    expect(result.ok).toBe(true)
    expect(result.extra).toEqual([])
  })

  it('reports extra tracks when removal is expected', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'x' }, { ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.extra).toEqual(['x'])
  })

  it('fails when a duplicate target occurrence is missing', () => {
    const result = validatePlaylistOrder(
      ['a', 'a', 'b'],
      [{ ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['a'])
  })

  it('reports surplus duplicate occurrences when removal is expected', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'a' }, { ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: false },
    )

    expect(result.ok).toBe(false)
    expect(result.extra).toEqual(['a'])
  })

  it('allows surplus duplicate occurrences when extra tracks are allowed and target order is a subsequence', () => {
    const result = validatePlaylistOrder(
      ['a', 'b'],
      [{ ratingKey: 'x' }, { ratingKey: 'a' }, { ratingKey: 'a' }, { ratingKey: 'b' }],
      { allowExtra: true },
    )

    expect(result.ok).toBe(true)
    expect(result.extra).toEqual([])
  })
})

describe('computeLCS', () => {
  it('returns all elements for identical arrays', () => {
    const result = computeLCS([1, 2, 3], [1, 2, 3])
    expect(result).toEqual(new Set([1, 2, 3]))
  })

  it('returns common subsequence', () => {
    const result = computeLCS([1, 2, 3], [1, 3, 5])
    expect(result).toEqual(new Set([1, 3]))
  })

  it('returns empty set when no common elements', () => {
    const result = computeLCS([1, 2], [3, 4])
    expect(result).toEqual(new Set())
  })

  it('returns empty set when both arrays are empty', () => {
    const result = computeLCS([], [])
    expect(result).toEqual(new Set())
  })

  it('returns empty set when one array is empty', () => {
    expect(computeLCS([1, 2], [])).toEqual(new Set())
    expect(computeLCS([], [1, 2])).toEqual(new Set())
  })

  it('returns matching single element', () => {
    expect(computeLCS([5], [5])).toEqual(new Set([5]))
  })

  it('returns empty set for mismatched single element', () => {
    expect(computeLCS([5], [3])).toEqual(new Set())
  })

  it('handles reversed arrays (LCS length 1)', () => {
    const result = computeLCS([1, 2, 3], [3, 2, 1])
    expect(result.size).toBe(1)
    expect([1, 2, 3]).toContain([...result][0])
  })

  it('keeps a maximum common subsequence when several choices are valid', () => {
    const result = computeLCS([1, 2, 3], [2, 1, 3])
    expect(result.size).toBe(2)
    expect([1, 2, 3].filter(id => result.has(id))).toEqual([2, 1, 3].filter(id => result.has(id)))
  })

  it('rejects duplicate concrete playlist item IDs', () => {
    expect(() => computeLCS([1, 1, 2], [1, 2, 2])).toThrow('唯一的 playlistItemID')
  })

  it('handles longer sequences without error', () => {
    const a = Array.from({ length: 50 }, (_, i) => i)
    const b = Array.from({ length: 50 }, (_, i) => i % 2 === 0 ? i : i + 100)
    const result = computeLCS(a, b)
    // Only even numbers match
    expect(result.size).toBe(25)
    for (let i = 0; i < 50; i += 2) {
      expect(result.has(i)).toBe(true)
    }
  })

  it('handles a large worst-case reorder within a bounded heap', () => {
    const size = 5_000
    const currentOrder = Array.from({ length: size }, (_, index) => index)
    const targetOrder = currentOrder.toReversed()

    const result = computeLCS(currentOrder, targetOrder)

    expect(result.size).toBe(1)
    expect(currentOrder).toContain([...result][0])
  }, 15_000)

  it('throws when Plex insert fails instead of silently reporting success', async () => {
    vi.mocked(insertTracksIntoPlaylist).mockRejectedValue(new Error('Plex insert failed'))

    await expect(applyFullReorder(
      'playlist-1',
      ['rating-1'],
      [],
      'section-1',
      () => false,
      () => {},
    )).rejects.toBeInstanceOf(PlexReorderError)
    expect(insertTracksIntoPlaylist).toHaveBeenCalledOnce()
  })

  it('never removes an old item when inserting its replacement fails', async () => {
    vi.mocked(insertTracksIntoPlaylist).mockRejectedValue(new Error('Plex insert failed'))

    await expect(applyFullReorder(
      'playlist-1',
      ['new-rating'],
      [{ ratingKey: 'old-rating', playlistItemId: 101 }],
      'section-1',
      () => false,
      () => {},
      { authorizedRemovalItemIds: new Set([101]) },
    )).rejects.toBeInstanceOf(PlexReorderError)

    expect(removeTrackFromPlaylist).not.toHaveBeenCalled()
  })

  it('inserts missing duplicate target occurrences', async () => {
    const result = await applyFullReorder(
      'playlist-1',
      ['rating-1', 'rating-1'],
      [{ ratingKey: 'rating-1', playlistItemId: 101 }],
      'section-1',
      () => false,
      () => {},
    )

    expect(result.inserted).toBe(1)
    expect(insertTracksIntoPlaylist).toHaveBeenCalledTimes(1)
    expect(insertTracksIntoPlaylist).toHaveBeenCalledWith('playlist-1', ['rating-1'])
  })

  it('removes surplus duplicate occurrences when exact sync is expected', async () => {
    const result = await applyFullReorder(
      'playlist-1',
      ['rating-1'],
      [
        { ratingKey: 'rating-1', playlistItemId: 101 },
        { ratingKey: 'rating-1', playlistItemId: 102 },
      ],
      'section-1',
      () => false,
      () => {},
      { authorizedRemovalItemIds: new Set([102]) },
    )

    expect(result.removed).toBe(1)
    expect(removeTrackFromPlaylist).toHaveBeenCalledWith('playlist-1', 102)
  })

  it('preserves every extra occurrence unless its concrete playlist item ID is authorized', async () => {
    const result = await applyFullReorder(
      'playlist-1',
      ['rating-1'],
      [
        { ratingKey: 'rating-1', playlistItemId: 101 },
        { ratingKey: 'old-rating', playlistItemId: 102 },
      ],
      'section-1',
      () => false,
      () => {},
    )

    expect(result.removed).toBe(0)
    expect(result.preserved).toBe(1)
    expect(result.mutations).toContainEqual(expect.objectContaining({
      action: 'preserve',
      ratingKey: 'old-rating',
      playlistItemId: 102,
      reason: expect.any(String),
    }))
    expect(removeTrackFromPlaylist).not.toHaveBeenCalled()
  })

  it('does not remove authorized extras when target reordering fails', async () => {
    vi.mocked(movePlaylistItemToTop).mockRejectedValue(new Error('Plex move failed'))
    vi.mocked(movePlaylistItemAfter).mockRejectedValue(new Error('Plex move failed'))

    await expect(applyFullReorder(
      'playlist-1',
      ['rating-2', 'rating-1'],
      [
        { ratingKey: 'rating-1', playlistItemId: 101 },
        { ratingKey: 'rating-2', playlistItemId: 102 },
        { ratingKey: 'old-rating', playlistItemId: 103 },
      ],
      'section-1',
      () => false,
      () => {},
      { authorizedRemovalItemIds: new Set([103]) },
    )).rejects.toBeInstanceOf(PlexReorderError)

    expect(removeTrackFromPlaylist).not.toHaveBeenCalled()
  })

  it('does not delete authorized old items when Plex move calls are no-ops', async () => {
    vi.mocked(movePlaylistItemToTop).mockResolvedValue(undefined)
    vi.mocked(movePlaylistItemAfter).mockResolvedValue(undefined)

    await expect(applyFullReorder(
      'playlist-1',
      ['rating-2', 'rating-1'],
      [
        { ratingKey: 'rating-1', playlistItemId: 101 },
        { ratingKey: 'rating-2', playlistItemId: 102 },
        { ratingKey: 'old-rating', playlistItemId: 103 },
      ],
      'section-1',
      () => false,
      () => {},
      { authorizedRemovalItemIds: new Set([103]) },
    )).rejects.toBeInstanceOf(PlexReorderError)

    expect(vi.mocked(movePlaylistItemAfter).mock.calls.length + vi.mocked(movePlaylistItemToTop).mock.calls.length).toBeGreaterThan(0)
    expect(removeTrackFromPlaylist).not.toHaveBeenCalled()
  })

  it('retains confirmed removal mutations when a later occurrence fails', async () => {
    vi.mocked(removeTrackFromPlaylist)
      .mockImplementationOnce(async (_key, id) => { playlist = playlist.filter(item => item.playlistItemId !== id) })
      .mockRejectedValueOnce(new Error('second delete failed'))

    let error: PlexReorderError | undefined
    try {
      await applyFullReorder(
        'playlist-1',
        ['target'],
        [
          { ratingKey: 'target', playlistItemId: 100 },
          { ratingKey: 'old-1', playlistItemId: 101 },
          { ratingKey: 'old-2', playlistItemId: 102 },
        ],
        'section-1',
        () => false,
        () => {},
        { authorizedRemovalItemIds: new Set([101, 102]) },
      )
    } catch (caught) {
      if (caught instanceof PlexReorderError) error = caught
      else throw caught
    }

    expect(error).toBeInstanceOf(PlexReorderError)
    expect(error?.result.removed).toBe(1)
    expect(error?.result.mutations).toContainEqual(expect.objectContaining({
      action: 'remove',
      ratingKey: 'old-1',
      playlistItemId: 101,
    }))
  })
})
