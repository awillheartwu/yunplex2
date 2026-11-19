import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '~~/server/lib/config/types'
import type { NeteaseSong } from '~~/server/lib/netease'
import type { PlexTrack } from '~~/server/lib/plex-client'

const { findTracksByFilePath, getRecentlyAddedTracks } = vi.hoisted(() => ({
  findTracksByFilePath: vi.fn(),
  getRecentlyAddedTracks: vi.fn(),
}))

vi.mock('~~/server/lib/plex-client', () => ({
  findTracksByFilePath,
  getRecentlyAddedTracks,
}))

vi.mock('~~/server/lib/sync/path-map', () => ({
  mapLocalPathToPlex: (value: string | null | undefined) => value ?? null,
  normalizeExistingLocalPath: (value: string | null | undefined) => (value ? value : null),
  resolveAccessibleLocalPath: (value: string | null | undefined) => value ?? null,
}))

import { matchTracksInPlexWithRetry } from '~~/server/lib/sync/plex-batch-match'

const cfg = {} as AppConfig

function song(id: number): NeteaseSong {
  return { id, name: `song-${id}` } as NeteaseSong
}

function request(key: string, filePath: string | null | undefined, id = 1) {
  return { key, song: song(id), filePath }
}

function track(ratingKey: string, file: string): PlexTrack {
  return {
    ratingKey,
    title: ratingKey,
    grandparentTitle: 'Artist',
    parentTitle: 'Album',
    Media: [{ Part: [{ file }] }],
  }
}

describe('plex batch exact-path matcher', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    findTracksByFilePath.mockResolvedValue([])
    getRecentlyAddedTracks.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries 1500 unresolved paths in shared rounds that wait at most five delays in total', async () => {
    vi.useFakeTimers()
    const requests = Array.from({ length: 1500 }, (_unused, index) =>
      request(`song-${index}`, `/downloads/Artist/Album/${index}.flac`, index))

    const promise = matchTracksInPlexWithRetry('12', requests, cfg, 5, 15000)
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })

    // Drive the fake clock in 250ms slices: the whole batch must finish within
    // 75s of virtual time even though all 1500 paths stay unresolved.
    for (let step = 0; step < 300; step++) {
      await vi.advanceTimersByTimeAsync(250)
      if (step === 298) expect(settled).toBe(false)
    }
    await expect(promise).resolves.toBeInstanceOf(Map)
    expect(settled).toBe(true)

    const results = await promise
    expect(results.size).toBe(1500)
    expect(results.get('song-0')).toMatchObject({ ratingKey: null, matchedBy: null, attempts: 6 })
    expect(results.get('song-0')!.traces).toHaveLength(6)
    expect(results.get('song-1499')!.attempts).toBe(6)
    expect(findTracksByFilePath).toHaveBeenCalledTimes(1500 * 6)
    expect(getRecentlyAddedTracks).toHaveBeenCalledTimes(6)
    expect(getRecentlyAddedTracks).toHaveBeenCalledWith('12', 100)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops retrying paths that resolved in an earlier round', async () => {
    vi.useFakeTimers()
    const hits = new Map([['/downloads/Artist/Album/a.flac', [track('rk-a', '/downloads/Artist/Album/a.flac')]]])
    findTracksByFilePath.mockImplementation(async (_section: string, filePath: string) => hits.get(filePath) ?? [])

    const promise = matchTracksInPlexWithRetry('12', [
      request('a', '/downloads/Artist/Album/a.flac', 1),
      request('b', '/downloads/Artist/Album/b.flac', 2),
    ], cfg, 2, 100)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)
    const results = await promise

    expect(results.get('a')).toMatchObject({ ratingKey: 'rk-a', matchedBy: 'path_lookup', attempts: 1 })
    expect(results.get('a')!.traces).toHaveLength(1)
    expect(results.get('b')).toMatchObject({ ratingKey: null, matchedBy: null, attempts: 3 })
    expect(results.get('b')!.traces).toHaveLength(3)

    const callsForA = findTracksByFilePath.mock.calls.filter(call => call[1] === '/downloads/Artist/Album/a.flac')
    const callsForB = findTracksByFilePath.mock.calls.filter(call => call[1] === '/downloads/Artist/Album/b.flac')
    expect(callsForA).toHaveLength(1)
    expect(callsForB).toHaveLength(3)
  })

  it('reads recently added once per round only while paths are still missing', async () => {
    vi.useFakeTimers()
    const promise = matchTracksInPlexWithRetry('12', [request('a', '/downloads/a.flac')], cfg, 1, 100)
    await vi.advanceTimersByTimeAsync(100)
    await promise

    expect(findTracksByFilePath).toHaveBeenCalledTimes(2)
    expect(getRecentlyAddedTracks).toHaveBeenCalledTimes(2)
  })

  it('skips the recently added read when every path resolves through the exact index', async () => {
    findTracksByFilePath.mockResolvedValue([track('rk-a', '/downloads/a.flac')])

    const results = await matchTracksInPlexWithRetry('12', [request('a', '/downloads/a.flac')], cfg, 0, 0)

    expect(results.get('a')).toMatchObject({ ratingKey: 'rk-a', matchedBy: 'path_lookup', attempts: 1 })
    expect(getRecentlyAddedTracks).not.toHaveBeenCalled()
  })

  it('resolves a missed path from the recently added fallback', async () => {
    getRecentlyAddedTracks.mockResolvedValue([track('rk-recent', '/downloads/new.flac')])

    const results = await matchTracksInPlexWithRetry('12', [request('a', '/downloads/new.flac')], cfg, 0, 0)

    expect(results.get('a')).toMatchObject({ ratingKey: 'rk-recent', matchedBy: 'recent_path_lookup', attempts: 1 })
    expect(getRecentlyAddedTracks).toHaveBeenCalledTimes(1)
  })

  it('refuses to bind when one exact path maps to multiple rating keys', async () => {
    findTracksByFilePath.mockResolvedValue([
      track('duplicate-a', '/downloads/dup.flac'),
      track('duplicate-b', '/downloads/dup.flac'),
    ])

    const results = await matchTracksInPlexWithRetry('12', [request('a', '/downloads/dup.flac')], cfg, 0, 0)

    expect(results.get('a')).toMatchObject({ ratingKey: null, matchedBy: null, attempts: 1 })
    expect(results.get('a')!.traces[0]?.pathCandidates).toBe(2)
  })

  it('refuses to bind when candidates stay ambiguous across index and recently added', async () => {
    findTracksByFilePath.mockResolvedValue([
      track('duplicate-a', '/downloads/dup.flac'),
      track('duplicate-b', '/downloads/dup.flac'),
    ])
    getRecentlyAddedTracks.mockResolvedValue([
      track('duplicate-a', '/downloads/dup.flac'),
      track('duplicate-c', '/downloads/dup.flac'),
    ])

    const results = await matchTracksInPlexWithRetry('12', [request('a', '/downloads/dup.flac')], cfg, 0, 0)

    expect(results.get('a')).toMatchObject({ ratingKey: null, matchedBy: null, attempts: 1 })
    expect(results.get('a')!.traces[0]?.pathCandidates).toBe(3)
  })

  it('returns an immediate terminal result for requests without a concrete path', async () => {
    const results = await matchTracksInPlexWithRetry('12', [
      request('missing', null),
      request('blank', ''),
    ], cfg, 3, 1000)

    expect(results.get('missing')).toMatchObject({ ratingKey: null, attempts: 4, localFilePath: null })
    expect(results.get('missing')!.traces).toHaveLength(4)
    expect(results.get('blank')!.attempts).toBe(4)
    expect(findTracksByFilePath).not.toHaveBeenCalled()
    expect(getRecentlyAddedTracks).not.toHaveBeenCalled()
  })

  it('bounds exact path lookups to three concurrent calls', async () => {
    vi.useFakeTimers()
    let started = 0
    let inFlight = 0
    let maxInFlight = 0
    findTracksByFilePath.mockImplementation(async () => {
      started += 1
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1000))
      inFlight -= 1
      return []
    })
    const requests = Array.from({ length: 7 }, (_unused, index) => request(`song-${index}`, `/downloads/${index}.flac`, index))

    const promise = matchTracksInPlexWithRetry('12', requests, cfg, 0, 0)
    expect(started).toBe(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toBe(6)
    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toBe(7)
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(maxInFlight).toBe(3)
    expect(findTracksByFilePath).toHaveBeenCalledTimes(7)
  })

  it('does not start path lookups when already cancelled', async () => {
    const promise = matchTracksInPlexWithRetry('12', [request('a', '/downloads/a.flac')], cfg, 0, 0, {
      throwIfCancelled: () => { throw new Error('cancelled') },
    })

    await expect(promise).rejects.toThrow('cancelled')
    expect(findTracksByFilePath).not.toHaveBeenCalled()
    expect(getRecentlyAddedTracks).not.toHaveBeenCalled()
  })

  it('observes cancellation right after a path lookup finishes', async () => {
    let cancelled = false
    findTracksByFilePath.mockImplementation(async () => {
      cancelled = true
      return [track('rk-a', '/downloads/a.flac')]
    })

    const promise = matchTracksInPlexWithRetry('12', [request('a', '/downloads/a.flac')], cfg, 0, 0, {
      throwIfCancelled: () => { if (cancelled) throw new Error('cancelled') },
    })

    await expect(promise).rejects.toThrow('cancelled')
    expect(findTracksByFilePath).toHaveBeenCalledTimes(1)
    expect(getRecentlyAddedTracks).not.toHaveBeenCalled()
  })

  it('aborts within one 250ms poll while waiting between rounds', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const promise = matchTracksInPlexWithRetry('12', [request('a', '/downloads/a.flac')], cfg, 5, 15000, {
      throwIfCancelled: () => { if (cancelled) throw new Error('cancelled') },
    })
    const rejection = expect(promise).rejects.toThrow('cancelled')

    // Let round 0 finish and the inter-round delay start, then cancel and only
    // advance one poll interval: cancellation must be noticed within it.
    let guard = 0
    while (vi.getTimerCount() === 0 && guard++ < 1000) await Promise.resolve()
    expect(vi.getTimerCount()).toBe(1)
    cancelled = true
    await vi.advanceTimersByTimeAsync(250)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })
})
