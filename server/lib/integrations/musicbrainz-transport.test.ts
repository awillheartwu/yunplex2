import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureMusicBrainzTransport,
  fetchMusicBrainzJson,
} from './musicbrainz-transport'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MusicBrainz transport', () => {
  it('applies the required user agent to every endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    configureMusicBrainzTransport({ requestIntervalMs: 0, requestTimeoutMs: 100 })

    await expect(fetchMusicBrainzJson('https://musicbrainz.org/ws/2/artist/?fmt=json'))
      .resolves.toMatchObject({ ok: true, status: 200 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'User-Agent': 'YunPlex2/1.0 (music-sync; +https://github.com/awillheartwu/reYunPlex)',
        },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('classifies an aborted request as a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      }),
    ))
    configureMusicBrainzTransport({ requestIntervalMs: 0, requestTimeoutMs: 5 })

    await expect(fetchMusicBrainzJson('https://musicbrainz.org/ws/2/recording/?query=slow'))
      .resolves.toEqual({ ok: false, status: null, reason: 'timeout' })
  })

  it('classifies not-found and server failures consistently', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    configureMusicBrainzTransport({ requestIntervalMs: 0, requestTimeoutMs: 100 })

    await expect(fetchMusicBrainzJson('https://musicbrainz.org/ws/2/recording/missing'))
      .resolves.toEqual({ ok: false, status: 404, reason: 'not_found' })
    await expect(fetchMusicBrainzJson('https://musicbrainz.org/ws/2/recording/?query=x'))
      .resolves.toEqual({ ok: false, status: 503, reason: 'http_503' })
  })
})
