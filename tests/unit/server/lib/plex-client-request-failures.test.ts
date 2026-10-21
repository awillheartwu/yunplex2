import { beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ query: vi.fn(), putQuery: vi.fn(), postQuery: vi.fn(), deleteQuery: vi.fn(), request: vi.fn() }))
vi.mock('~~/server/lib/plex-http', () => ({ createPlexHttpClient: () => transport }))

const config = { server: 'fixture.invalid', port: 32400, token: 'fixture', section: 'Music' }
const reset = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })

beforeEach(() => { vi.resetModules(); vi.resetAllMocks() })

describe('Plex request failures', () => {
  it('surfaces a connection failure immediately for the source failure budget', async () => {
    const error = reset()
    transport.query.mockRejectedValueOnce(error).mockResolvedValueOnce({ MediaContainer: { machineIdentifier: 'fixture-machine' } })
    const { initPlexClient } = await import('~~/server/lib/plex-client')
    await expect(initPlexClient(config)).rejects.toBe(error)
    expect(transport.query.mock.calls).toEqual([['/']])
  })

  it('rejects an incomplete playlist instead of treating a failed page as the full target', async () => {
    const error = reset()
    transport.query.mockImplementation(async (path: string) => {
      const start = new URL(path, 'http://fixture.invalid').searchParams.get('X-Plex-Container-Start')
      if (start === '0') return { MediaContainer: { totalSize: 2, Metadata: [{ ratingKey: '1' }] } }
      if (transport.query.mock.calls.length === 2) throw error
      return { MediaContainer: { totalSize: 2, Metadata: [{ ratingKey: '2' }] } }
    })
    const { createPlexClient, getPlaylistTracks } = await import('~~/server/lib/plex-client')
    createPlexClient(config)
    await expect(getPlaylistTracks('playlist', 99999)).rejects.toBe(error)
    expect(transport.query.mock.calls.map(([path]) => new URL(path, 'http://fixture.invalid').searchParams.get('X-Plex-Container-Start'))).toEqual(['0', '1'])
  })

  it('does not retry authorization failures', async () => {
    const error = Object.assign(new Error('unauthorized'), { statusCode: 401 })
    transport.query.mockRejectedValue(error)
    const { initPlexClient } = await import('~~/server/lib/plex-client')
    await expect(initPlexClient(config)).rejects.toBe(error)
    expect(transport.query).toHaveBeenCalledTimes(1)
  })

  it('does not replay playlist writes or library refreshes after an uncertain result', async () => {
    const error = reset()
    transport.query.mockResolvedValue({ MediaContainer: { machineIdentifier: 'fixture-machine' } })
    const { initPlexClient, insertTrackIntoPlaylist, refreshLibrary } = await import('~~/server/lib/plex-client')
    await initPlexClient(config)
    transport.putQuery.mockRejectedValue(error)
    await expect(insertTrackIntoPlaylist('playlist', 'track')).rejects.toBe(error)
    expect(transport.putQuery).toHaveBeenCalledTimes(1)
    transport.query.mockResolvedValue({ MediaContainer: { Directory: [{ key: '12', refreshing: false }] } })
    transport.request.mockRejectedValue(error)
    await expect(refreshLibrary('12')).rejects.toBe(error)
    expect(transport.request.mock.calls).toEqual([['/library/sections/12/refresh', 'POST']])
  })
})
