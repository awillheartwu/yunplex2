import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ query: vi.fn(), putQuery: vi.fn(), postQuery: vi.fn(), deleteQuery: vi.fn() }))
vi.mock('plex-api', () => ({ default: vi.fn(function MockPlexApi() { return transport }) }))

const config = { server: 'fixture.invalid', port: 32400, token: 'fixture', section: 'Music' }
const reset = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })

beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('Plex connection recovery', () => {
  it('recovers initialization from a reset without converting the target to missing media', async () => {
    transport.query.mockRejectedValueOnce(reset()).mockResolvedValueOnce({ MediaContainer: { machineIdentifier: 'fixture-machine' } })
    const { initPlexClient } = await import('~~/server/lib/plex-client')
    const pending = expect(initPlexClient(config)).resolves.toBe('fixture-machine')
    await vi.advanceTimersByTimeAsync(250)
    await pending
    expect(transport.query.mock.calls).toEqual([['/'], ['/']])
  })

  it('retries the failed page without repeating earlier playlist pages', async () => {
    transport.query.mockImplementation(async (path: string) => {
      const start = new URL(path, 'http://fixture.invalid').searchParams.get('X-Plex-Container-Start')
      if (start === '0') return { MediaContainer: { totalSize: 2, Metadata: [{ ratingKey: '1' }] } }
      if (transport.query.mock.calls.length === 2) throw reset()
      return { MediaContainer: { totalSize: 2, Metadata: [{ ratingKey: '2' }] } }
    })
    const { createPlexClient, getPlaylistTracks } = await import('~~/server/lib/plex-client')
    createPlexClient(config)
    const pending = expect(getPlaylistTracks('playlist', 99999)).resolves.toEqual([{ ratingKey: '1' }, { ratingKey: '2' }])
    await vi.advanceTimersByTimeAsync(250)
    await pending
    expect(transport.query.mock.calls.map(([path]) => new URL(path, 'http://fixture.invalid').searchParams.get('X-Plex-Container-Start'))).toEqual(['0', '1', '1'])
  })

  it('fails after a finite number of connection resets and preserves the original error', async () => {
    const error = reset()
    transport.query.mockRejectedValue(error)
    const { initPlexClient } = await import('~~/server/lib/plex-client')
    const pending = expect(initPlexClient(config)).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(1000)
    await pending
    expect(transport.query).toHaveBeenCalledTimes(3)
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
    transport.query.mockReset().mockRejectedValue(error)
    await expect(refreshLibrary('12')).rejects.toBe(error)
    expect(transport.query).toHaveBeenCalledTimes(1)
  })
})
