import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), tmpdir: () => state.directory }))

const require = createRequire(import.meta.url)
const sdkRequire = createRequire(require.resolve('@neteasecloudmusicapienhanced/api'))
const keyProvider = sdkRequire('./util/xeapiKey.js') as { getXeapiPublicKey(current: object, deviceId: string): Promise<{ sk?: string }> }
const transport = sdkRequire('axios').default
const originalLog = console.log

beforeEach(() => {
  state.directory = mkdtempSync('/tmp/reyunplex-netease-initialization-')
  vi.resetModules()
  vi.useFakeTimers()
  // The SDK boundary is replaced; these cases never install global interceptors or contact it.
  vi.spyOn(transport.interceptors.request, 'use').mockReturnValue(0)
  vi.spyOn(transport.interceptors.response, 'use').mockReturnValue(0)
})

afterEach(() => {
  console.log = originalLog
  vi.restoreAllMocks()
  vi.useRealTimers()
  rmSync(state.directory, { recursive: true, force: true })
})

describe('Netease cold initialization', () => {
  it('shares audio initialization, leaves metadata available, and isolates a cancelled caller', async () => {
    let ready!: (key: { sk: string }) => void
    const initialize = vi.spyOn(keyProvider, 'getXeapiPublicKey').mockImplementation(() => new Promise(resolve => { ready = resolve }))
    const { controlledNeteaseRequest } = await import('~~/server/lib/download/netease-request')
    const { withExternalRequestSignal } = await import('~~/server/lib/external-request-context')
    const controller = new AbortController()
    const cancelled = new Error('cancel one source')
    const first = expect(withExternalRequestSignal(controller.signal,
      () => controlledNeteaseRequest(async () => 'cancelled audio', 'song_url_v1'))).rejects.toBe(cancelled)
    const second = controlledNeteaseRequest(async () => 'full audio', 'song_url_v1')
    const metadata = controlledNeteaseRequest(async () => 'playlist', 'playlist_detail')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(metadata).resolves.toBe('playlist')
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize.mock.calls[0]?.[0]).toEqual({})
    controller.abort(cancelled)
    await first
    ready({ sk: 'fixture-key' })
    await expect(second).resolves.toBe('full audio')
    expect(JSON.parse(readFileSync(join(state.directory, 'xeapi_public_key'), 'utf8'))).toEqual({ sk: 'fixture-key' })
  })

  it('releases failed initialization so the next audio attempt can initialize again', async () => {
    const initialize = vi.spyOn(keyProvider, 'getXeapiPublicKey')
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ sk: 'fixture-key' })
    const { controlledNeteaseRequest } = await import('~~/server/lib/download/netease-request')
    await expect(controlledNeteaseRequest(async () => 'audio', 'song_url_v1')).rejects.toMatchObject({
      code: 'NETEASE_INITIALIZATION_FAILED', endpoint: 'song_url_v1', durationMs: expect.any(Number),
    })
    const retried = controlledNeteaseRequest(async () => 'audio', 'song_url_v1')
    await vi.advanceTimersByTimeAsync(250)
    await expect(retried).resolves.toBe('audio')
    expect(initialize).toHaveBeenCalledTimes(2)
  })

  it('redacts SDK rejection logs before exposing them to the application logger', async () => {
    const lines: unknown[][] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args) })
    const { controlledNeteaseRequest } = await import('~~/server/lib/download/netease-request')
    await controlledNeteaseRequest(async () => {
      console.log('[ERR]', { cookie: 'fixture-cookie', 'set-cookie': ['MUSIC_U=fixture-music'], token: 'fixture-token', message: 'HTTP 503' })
      return { status: 200 }
    }, 'playlist_detail')
    const logged = JSON.stringify(lines)
    expect(logged).toContain('HTTP 503')
    for (const secret of ['fixture-cookie', 'fixture-music', 'fixture-token']) expect(logged).not.toContain(secret)
  })
})
