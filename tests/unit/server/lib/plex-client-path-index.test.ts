import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const plexApiMock = vi.hoisted(() => ({
  query: vi.fn(),
  activeServer: '',
}))

vi.mock('plex-api', () => ({
  default: vi.fn(function MockPlexApi(options: { hostname?: string }) {
    plexApiMock.activeServer = options.hostname ?? ''
    return {
      query: plexApiMock.query,
      postQuery: vi.fn(),
      putQuery: vi.fn(),
      deleteQuery: vi.fn(),
    }
  }),
}))

const config = {
  server: 'plex.local',
  port: 32400,
  token: 'test-token',
  section: 'Music',
}

function track(ratingKey: string, file: string) {
  return {
    ratingKey,
    title: `Track ${ratingKey}`,
    grandparentTitle: 'Artist',
    parentTitle: 'Album',
    Media: [{ Part: [{ file }] }],
  }
}

describe('Plex section path index', () => {
  beforeEach(() => {
    vi.resetModules()
    plexApiMock.query.mockReset()
    plexApiMock.activeServer = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('finds a file from a later Plex library page', async () => {
    const target = track('3', '/volume1/music/Artist/Album/03.flac')
    const requestedStarts: number[] = []

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      const url = new URL(path, 'http://plex.local')
      const start = Number(url.searchParams.get('X-Plex-Container-Start') ?? 0)
      requestedStarts.push(start)
      if (start === 0) {
        return {
          MediaContainer: {
            totalSize: 3,
            size: 2,
            offset: 0,
            Metadata: [track('1', '/volume1/music/Artist/Album/01.flac'), track('2', '/volume1/music/Artist/Album/02.flac')],
          },
        }
      }
      if (start === 2) {
        return {
          MediaContainer: {
            totalSize: 3,
            size: 1,
            offset: 2,
            Metadata: [target],
          },
        }
      }
      throw new Error(`Unexpected page start: ${start}`)
    })

    const { findTrackByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(findTrackByFilePath('12', target.Media[0]!.Part[0]!.file)).resolves.toEqual(target)
    expect(requestedStarts).toEqual([0, 2])
  })

  it('returns every Plex candidate whose file path has the same NFC identity', async () => {
    const composedPath = '/volume1/music/Beyonc\u00e9/01.flac'
    const decomposedPath = '/volume1/music/Beyonce\u0301/01.flac'
    const first = track('11', decomposedPath)
    const second = track('12', composedPath)

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      return {
        MediaContainer: {
          totalSize: 2,
          size: 2,
          offset: 0,
          Metadata: [first, second],
        },
      }
    })

    const { findTracksByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(findTracksByFilePath('12', composedPath)).resolves.toEqual([first, second])
  })

  it('falls back to a unique case-insensitive path identity', async () => {
    const candidate = track('case-only', '/volume1/music/Artist/Album/03 - Song.FLAC')
    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      return { MediaContainer: { totalSize: 1, Metadata: [candidate] } }
    })

    const { findTracksByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(findTracksByFilePath('12', '/volume1/music/Artist/Album/03 - Song.flac'))
      .resolves.toEqual([candidate])
  })

  it('does not guess when a case-insensitive path identity is ambiguous', async () => {
    const upper = track('upper', '/volume1/music/Artist/Album/Song.FLAC')
    const lower = track('lower', '/volume1/music/Artist/Album/song.flac')
    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      return { MediaContainer: { totalSize: 2, Metadata: [upper, lower] } }
    })

    const { findTracksByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(findTracksByFilePath('12', '/volume1/music/artist/album/song.FLAC'))
      .resolves.toEqual([])
  })

  it('indexes every media part exposed by a Plex track', async () => {
    const alternatePath = '/volume1/music/Artist/Album/alternate.flac'
    const candidate = {
      ...track('13', '/volume1/music/Artist/Album/original.flac'),
      Media: [
        { Part: [{ file: '/volume1/music/Artist/Album/original.flac' }] },
        { Part: [{ file: alternatePath }] },
      ],
    }

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      return {
        MediaContainer: {
          totalSize: 1,
          size: 1,
          offset: 0,
          Metadata: [candidate],
        },
      }
    })

    const { findTrackByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(findTrackByFilePath('12', alternatePath)).resolves.toEqual(candidate)
  })

  it('does not turn the same ratingKey repeated across pages into a path conflict', async () => {
    const filePath = '/volume1/music/Artist/Album/14.flac'
    const candidate = track('14', filePath)

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      const url = new URL(path, 'http://plex.local')
      const start = Number(url.searchParams.get('X-Plex-Container-Start') ?? 0)
      return {
        MediaContainer: {
          totalSize: 2,
          size: 1,
          offset: start,
          Metadata: [{ ...candidate }],
        },
      }
    })

    const { findTracksByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(findTracksByFilePath('12', filePath)).resolves.toEqual([candidate])
  })

  it('reuses one section snapshot for repeated path lookups within the short cache window', async () => {
    const first = track('21', '/volume1/music/Artist/Album/21.flac')
    const second = track('22', '/volume1/music/Artist/Album/22.flac')
    let libraryQueries = 0

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      libraryQueries += 1
      return {
        MediaContainer: {
          totalSize: 2,
          size: 2,
          offset: 0,
          Metadata: [first, second],
        },
      }
    })

    const { findTrackByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(findTrackByFilePath('12', first.Media[0]!.Part[0]!.file)).resolves.toEqual(first)
    await expect(findTrackByFilePath('12', second.Media[0]!.Part[0]!.file)).resolves.toEqual(second)
    expect(libraryQueries).toBe(1)
  })

  it('shares one in-flight section snapshot between concurrent path lookups', async () => {
    const candidate = track('25', '/volume1/music/Artist/Album/25.flac')
    let libraryQueries = 0

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      libraryQueries += 1
      await Promise.resolve()
      return {
        MediaContainer: {
          totalSize: 1,
          size: 1,
          offset: 0,
          Metadata: [candidate],
        },
      }
    })

    const { findTrackByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    const [first, second] = await Promise.all([
      findTrackByFilePath('12', candidate.Media[0]!.Part[0]!.file),
      findTrackByFilePath('12', candidate.Media[0]!.Part[0]!.file),
    ])

    expect(first).toEqual(candidate)
    expect(second).toEqual(candidate)
    expect(libraryQueries).toBe(1)
  })

  it('rebuilds an expired section snapshot', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T00:00:00Z'))
    const filePath = '/volume1/music/Artist/Album/23.flac'
    const beforeExpiry = track('23', filePath)
    const afterExpiry = track('24', filePath)
    let libraryQueries = 0

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      libraryQueries += 1
      const current = libraryQueries === 1 ? beforeExpiry : afterExpiry
      return {
        MediaContainer: {
          totalSize: 1,
          size: 1,
          offset: 0,
          Metadata: [current],
        },
      }
    })

    const { findTrackByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)
    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(beforeExpiry)

    vi.advanceTimersByTime(30_001)

    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(afterExpiry)
    expect(libraryQueries).toBe(2)
  })

  it('keeps the cache across identical init calls but isolates it from a different Plex server', async () => {
    const filePath = '/volume1/music/Artist/Album/31.flac'
    const firstServerTrack = track('31', filePath)
    const secondServerTrack = track('32', filePath)
    let libraryQueries = 0

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: `${plexApiMock.activeServer}-machine` } }
      libraryQueries += 1
      const current = plexApiMock.activeServer === config.server ? firstServerTrack : secondServerTrack
      return {
        MediaContainer: {
          totalSize: 1,
          size: 1,
          offset: 0,
          Metadata: [current],
        },
      }
    })

    const { findTrackByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)
    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(firstServerTrack)

    await initPlexClient({ ...config })
    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(firstServerTrack)
    expect(libraryQueries).toBe(1)

    await initPlexClient({ ...config, server: 'other-plex.local' })
    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(secondServerTrack)
    expect(libraryQueries).toBe(2)
  })

  it('invalidates a same-config cache when the Plex machine identity changes', async () => {
    const filePath = '/volume1/music/Artist/Album/33.flac'
    const firstMachineTrack = track('33', filePath)
    const replacementMachineTrack = track('34', filePath)
    let machineIdentifier = 'machine-1'
    let libraryQueries = 0

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier } }
      libraryQueries += 1
      const current = machineIdentifier === 'machine-1' ? firstMachineTrack : replacementMachineTrack
      return {
        MediaContainer: {
          totalSize: 1,
          size: 1,
          offset: 0,
          Metadata: [current],
        },
      }
    })

    const { findTrackByFilePath, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)
    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(firstMachineTrack)

    machineIdentifier = 'machine-2'
    await initPlexClient({ ...config })

    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(replacementMachineTrack)
    expect(libraryQueries).toBe(2)
  })

  it('rebuilds the section path index after a full Plex library refresh', async () => {
    const filePath = '/volume1/music/Artist/Album/41.flac'
    const beforeRefresh = track('41', filePath)
    const afterRefresh = track('42', filePath)
    let libraryQueries = 0

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      if (path === '/library/sections/12/refresh') return { MediaContainer: {} }
      libraryQueries += 1
      const current = libraryQueries === 1 ? beforeRefresh : afterRefresh
      return {
        MediaContainer: {
          totalSize: 1,
          size: 1,
          offset: 0,
          Metadata: [current],
        },
      }
    })

    const { findTrackByFilePath, initPlexClient, refreshLibrary } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)
    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(beforeRefresh)

    await refreshLibrary('12')

    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(afterRefresh)
    expect(libraryQueries).toBe(2)
  })

  it('rebuilds the section path index after a targeted Plex path refresh', async () => {
    const filePath = '/volume1/music/Artist/Album/51.flac'
    const beforeRefresh = track('51', filePath)
    const afterRefresh = track('52', filePath)
    let libraryQueries = 0

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      if (path.startsWith('/library/sections/12/refresh?path=')) return { MediaContainer: {} }
      libraryQueries += 1
      const current = libraryQueries === 1 ? beforeRefresh : afterRefresh
      return {
        MediaContainer: {
          totalSize: 1,
          size: 1,
          offset: 0,
          Metadata: [current],
        },
      }
    })

    const { findTrackByFilePath, initPlexClient, refreshPath } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)
    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(beforeRefresh)

    await refreshPath('12', '/volume1/music/Artist/Album')

    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(afterRefresh)
    expect(libraryQueries).toBe(2)
  })

  it('does not recache a stale snapshot that finishes after a Plex refresh', async () => {
    const filePath = '/volume1/music/Artist/Album/61.flac'
    const staleTrack = track('61', filePath)
    const freshTrack = track('62', filePath)
    let libraryQueries = 0
    let releaseFirstPage!: (value: unknown) => void
    const firstPage = new Promise<unknown>((resolve) => {
      releaseFirstPage = resolve
    })

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      if (path === '/library/sections/12/refresh') return { MediaContainer: {} }
      libraryQueries += 1
      if (libraryQueries === 1) return firstPage
      return {
        MediaContainer: {
          totalSize: 1,
          size: 1,
          offset: 0,
          Metadata: [freshTrack],
        },
      }
    })

    const { findTrackByFilePath, initPlexClient, refreshLibrary } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)
    const staleLookup = findTrackByFilePath('12', filePath)
    await vi.waitFor(() => expect(libraryQueries).toBe(1))

    await refreshLibrary('12')
    releaseFirstPage({
      MediaContainer: {
        totalSize: 1,
        size: 1,
        offset: 0,
        Metadata: [staleTrack],
      },
    })
    await expect(staleLookup).resolves.toEqual(staleTrack)

    await expect(findTrackByFilePath('12', filePath)).resolves.toEqual(freshTrack)
    expect(libraryQueries).toBe(2)
  })

  it('serves a freshly scanned song from the addedAt track listing while the path cache is stale', async () => {
    const oldFilePath = '/volume1/music/Artist/Album/01.flac'
    const newFilePath = '/volume1/music/Artist/Album/02 - New.flac'
    const oldTrack = track('71', oldFilePath)
    const newTrack = track('72', newFilePath)
    // On NAS, recentlyAdded returns albums without Media.Part.file, so the
    // recent-track fallback must not depend on that shape.
    const albumOnly = { ratingKey: 'album-71', title: 'Album', type: 'album' }
    const recentQuery = '/library/sections/12/all?type=10&sort=addedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=100'
    let librarySnapshot = [oldTrack]
    let libraryQueries = 0

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      if (path === recentQuery) return { MediaContainer: { totalSize: 1, Metadata: [newTrack] } }
      if (path.startsWith('/library/sections/12/recentlyAdded')) {
        return { MediaContainer: { totalSize: 1, Metadata: [albumOnly] } }
      }
      if (path.includes('includeGuids=1')) {
        libraryQueries += 1
        return { MediaContainer: { totalSize: librarySnapshot.length, Metadata: librarySnapshot } }
      }
      throw new Error(`Unexpected Plex query: ${path}`)
    })

    const { findTrackByFilePath, getRecentlyAddedTracks, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(findTrackByFilePath('12', oldFilePath)).resolves.toEqual(oldTrack)

    // The new song is scanned after the path snapshot was warmed.
    librarySnapshot = [oldTrack, newTrack]

    await expect(findTrackByFilePath('12', newFilePath)).resolves.toBeNull()
    expect(libraryQueries).toBe(1)

    const recent = await getRecentlyAddedTracks('12', 100)
    expect(recent).toEqual([newTrack])
    expect(recent[0]?.Media?.[0]?.Part?.[0]?.file).toBe(newFilePath)
    expect(plexApiMock.query).toHaveBeenCalledWith(recentQuery)
    expect(plexApiMock.query).not.toHaveBeenCalledWith(expect.stringContaining('/recentlyAdded'))
  })
})

describe('Plex playlist pagination', () => {
  beforeEach(() => {
    vi.resetModules()
    plexApiMock.query.mockReset()
    plexApiMock.activeServer = ''
  })

  it('reads every playlist page and preserves duplicate occurrences and order', async () => {
    const requestedStarts: number[] = []
    const first = track('1', '/music/1.flac')
    const duplicate = { ...track('1', '/music/1.flac'), playlistItemID: 102 }
    const last = track('2', '/music/2.flac')

    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      const url = new URL(path, 'http://plex.local')
      const start = Number(url.searchParams.get('X-Plex-Container-Start') ?? 0)
      requestedStarts.push(start)
      if (start === 0) return { MediaContainer: { totalSize: 3, Metadata: [first, duplicate] } }
      if (start === 2) return { MediaContainer: { totalSize: 3, Metadata: [last] } }
      throw new Error(`Unexpected page start: ${start}`)
    })

    const { getPlaylistTracks, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(getPlaylistTracks('43411', 10)).resolves.toEqual([first, duplicate, last])
    expect(requestedStarts).toEqual([0, 2])
  })

  it('stops at the requested playlist occurrence limit', async () => {
    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      return { MediaContainer: { totalSize: 3, Metadata: [track('1', '/music/1.flac')] } }
    })

    const { getPlaylistTracks, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(getPlaylistTracks('43411', 1)).resolves.toHaveLength(1)
    expect(plexApiMock.query).toHaveBeenCalledTimes(2) // init + one playlist page
  })
})

describe('Plex playlist lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    plexApiMock.query.mockReset()
    plexApiMock.activeServer = ''
  })

  it('treats a deleted bound playlist as missing so the sync can recreate it', async () => {
    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      if (path === '/playlists/43390') {
        throw new Error('Plex Server didnt respond with a valid 2xx status code, response code: 404')
      }
      throw new Error(`Unexpected Plex query: ${path}`)
    })

    const { getPlaylistSnapshotByRatingKey, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(getPlaylistSnapshotByRatingKey('43390', 99999)).resolves.toBeNull()
  })

  it('does not misclassify a Plex outage as a deleted playlist', async () => {
    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      if (path === '/playlists/43390') {
        throw new Error('Plex Server didnt respond with a valid 2xx status code, response code: 503')
      }
      throw new Error(`Unexpected Plex query: ${path}`)
    })

    const { getPlaylistSnapshotByRatingKey, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(getPlaylistSnapshotByRatingKey('43390', 99999)).rejects.toThrow('503')
  })

  it('handles a playlist deleted between its metadata and items requests', async () => {
    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      if (path === '/playlists/43390') {
        return {
          MediaContainer: {
            Metadata: { title: '已删除的目标', ratingKey: '43390', updatedAt: 123 },
          },
        }
      }
      if (path.startsWith('/playlists/43390/items?')) {
        throw Object.assign(new Error('not found'), { statusCode: 404 })
      }
      throw new Error(`Unexpected Plex query: ${path}`)
    })

    const { getPlaylistSnapshotByRatingKey, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(getPlaylistSnapshotByRatingKey('43390', 99999)).resolves.toBeNull()
  })

  it('surfaces a metadata endpoint outage instead of accepting a partial snapshot', async () => {
    let metadataReads = 0
    plexApiMock.query.mockImplementation(async (path: string) => {
      if (path === '/') return { MediaContainer: { machineIdentifier: 'machine-1' } }
      if (path === '/playlists/43390') {
        metadataReads++
        if (metadataReads === 1) {
          return {
            MediaContainer: {
              Metadata: { title: '目标歌单', ratingKey: '43390', updatedAt: 123 },
            },
          }
        }
        throw new Error('Plex Server didnt respond with a valid 2xx status code, response code: 503')
      }
      if (path.startsWith('/playlists/43390/items?')) {
        return { MediaContainer: { totalSize: 0, Metadata: [] } }
      }
      throw new Error(`Unexpected Plex query: ${path}`)
    })

    const { getPlaylistSnapshotByRatingKey, initPlexClient } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)

    await expect(getPlaylistSnapshotByRatingKey('43390', 99999)).rejects.toThrow('503')
  })
})
