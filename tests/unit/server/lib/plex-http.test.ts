import { describe, expect, it, vi } from 'vitest'
import { getPlaylistTracks, initPlexClient } from '~~/server/lib/plex-client'
import { withExternalRequestSignal } from '~~/server/lib/external-request-context'
import { createPlexHttpClient } from '~~/server/lib/plex-http'
import {
  plexConfig,
  sendJson,
  sendText,
  startPlexContractServer,
  type PlexContractServer,
} from '~~/tests/helpers/plex-contract-server'

describe('Plex HTTP contract', () => {
  it('sends Plex API headers and returns the JSON response metadata', async () => {
    let server: PlexContractServer | undefined
    try {
      server = await startPlexContractServer((_request, response) => {
        sendJson(response, { MediaContainer: { Directory: [{ key: '12', title: 'Music' }] } }, 200, {
          ETag: 'plex-library-v1',
        })
      })
      const client = createPlexHttpClient(plexConfig(server.port, { token: 'fixture-secret' }))

      const result = await client.request('/library/sections?includeHidden=1')

      expect(result).toMatchObject({
        status: 200,
        data: { MediaContainer: { Directory: [{ key: '12', title: 'Music' }] } },
      })
      expect(result.headers.get('etag')).toBe('plex-library-v1')
      expect(server.requests).toHaveLength(1)
      expect(server.requests[0]).toMatchObject({
        method: 'GET',
        url: '/library/sections?includeHidden=1',
      })
      const headers = server.requests[0]!.headers
      expect(headers.accept).toBe('application/json')
      expect(headers['x-plex-token']).toBe('fixture-secret')
      expect(headers['x-plex-client-identifier']).toMatch(/^[0-9a-f-]{36}$/)
      expect(headers['x-plex-product']).toBe('YunPlex')
      expect(headers['x-plex-pms-api-version']).toBe('1.0')
      expect(headers['x-plex-version']).toBeTruthy()
    } finally {
      await server?.close()
    }
  })

  it('reads every playlist page through the JSON API until totalSize is reached', async () => {
    let server: PlexContractServer | undefined
    try {
      server = await startPlexContractServer((_request, response, recorded) => {
        if (recorded.url === '/') {
          sendJson(response, { MediaContainer: { machineIdentifier: 'fixture-machine' } })
          return
        }
        const url = new URL(recorded.url, 'http://plex.invalid')
        if (url.pathname !== '/playlists/42/items') {
          sendText(response, 'not found', 404)
          return
        }
        const start = Number(url.searchParams.get('X-Plex-Container-Start'))
        sendJson(response, {
          MediaContainer: {
            totalSize: 3,
            Metadata: start === 0
              ? [{ ratingKey: 'first', title: 'First' }, { ratingKey: 'second', title: 'Second' }]
              : [{ ratingKey: 'third', title: 'Third' }],
          },
        })
      })
      await initPlexClient(plexConfig(server.port))

      await expect(getPlaylistTracks('42', 3)).resolves.toEqual([
        { ratingKey: 'first', title: 'First' },
        { ratingKey: 'second', title: 'Second' },
        { ratingKey: 'third', title: 'Third' },
      ])
      expect(server.requests.slice(1).map(({ url }) => {
        const parsed = new URL(url, 'http://plex.invalid')
        return [parsed.pathname, parsed.searchParams.get('X-Plex-Container-Start'), parsed.searchParams.get('X-Plex-Container-Size')]
      })).toEqual([
        ['/playlists/42/items', '0', '3'],
        ['/playlists/42/items', '2', '1'],
      ])
    } finally {
      await server?.close()
    }
  })

  it('accepts an HTML refresh acknowledgement after a mutation', async () => {
    let server: PlexContractServer | undefined
    try {
      server = await startPlexContractServer((_request, response) => {
        sendText(response, '<html><body>Refresh started</body></html>', 200, { 'Content-Type': 'text/html' })
      })
      const client = createPlexHttpClient(plexConfig(server.port))

      await expect(client.postQuery('/library/sections/12/refresh')).resolves.toEqual({})
      expect(server.requests[0]).toMatchObject({ method: 'POST', url: '/library/sections/12/refresh' })
    } finally {
      await server?.close()
    }
  })

  it('reports HTTP status and invalid JSON as Plex request failures', async () => {
    let server: PlexContractServer | undefined
    try {
      server = await startPlexContractServer((_request, response, recorded) => {
        if (recorded.url === '/unauthorized') sendJson(response, { error: 'unauthorized' }, 401)
        else if (recorded.url === '/broken') sendText(response, '{"MediaContainer":', 200, { 'Content-Type': 'application/json' })
        else sendText(response, '<html>HTML is not JSON</html>', 200, { 'Content-Type': 'text/html' })
      })
      const client = createPlexHttpClient(plexConfig(server.port))

      await expect(client.query('/unauthorized')).rejects.toMatchObject({
        status: 401,
        httpStatus: 401,
      })
      await expect(client.query('/broken')).rejects.toThrow('未返回有效 JSON')
      await expect(client.query('/html')).rejects.toThrow('未返回有效 JSON')
    } finally {
      await server?.close()
    }
  })

  it('propagates caller cancellation while a response body is still pending', async () => {
    let server: PlexContractServer | undefined
    let started!: () => void
    const responseStarted = new Promise<void>(resolve => { started = resolve })
    try {
      server = await startPlexContractServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.flushHeaders()
        response.write('{"MediaContainer":')
        started()
      })
      const client = createPlexHttpClient(plexConfig(server.port))
      const caller = new AbortController()
      const reason = new Error('source request cancelled')
      const pending = withExternalRequestSignal(caller.signal, () => client.query('/slow'))
      await responseStarted
      const rejection = expect(pending).rejects.toBe(reason)

      caller.abort(reason)

      await rejection
    } finally {
      await server?.close()
    }
  })

  it('turns an expired request deadline into a typed timeout while reading the response body', async () => {
    let server: PlexContractServer | undefined
    let started!: () => void
    const responseStarted = new Promise<void>(resolve => { started = resolve })
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    try {
      server = await startPlexContractServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.flushHeaders()
        response.write('{"MediaContainer":')
        started()
      })
      const client = createPlexHttpClient(plexConfig(server.port))
      const pending = expect(client.query('/slow')).rejects.toMatchObject({ code: 'ETIMEDOUT' })
      await responseStarted
      deadline.abort(new DOMException('Deadline expired', 'TimeoutError'))
      await pending
      expect(timeout).toHaveBeenCalledWith(30_000)
    } finally {
      timeout.mockRestore()
      await server?.close()
    }
  })
})
