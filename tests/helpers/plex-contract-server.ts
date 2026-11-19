import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import type { PlexConfig } from '~~/server/lib/config/types'

export interface RecordedPlexRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
}

export interface PlexSseConnection {
  readonly closed: boolean
  readonly closedPromise: Promise<void>
  write(chunk: string | Buffer): void
  end(): void
}

export interface PlexContractServer {
  readonly port: number
  readonly requests: RecordedPlexRequest[]
  close(): Promise<void>
}

type PlexContractHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  recorded: RecordedPlexRequest,
) => void | Promise<void>

export function plexConfig(port: number, overrides: Partial<PlexConfig> = {}): PlexConfig {
  return {
    server: '127.0.0.1',
    port,
    token: 'fixture-token',
    section: 'Music',
    ...overrides,
  }
}

export async function startPlexContractServer(handler: PlexContractHandler): Promise<PlexContractServer> {
  const requests: RecordedPlexRequest[] = []
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    const recorded = {
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: request.headers,
    }
    requests.push(recorded)
    void Promise.resolve(handler(request, response, recorded)).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' })
      response.destroy(error instanceof Error ? error : new Error(String(error)))
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error)
    server.once('error', failed)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed)
      resolve()
    })
  })

  let closing: Promise<void> | null = null
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close() {
      if (closing) return closing
      closing = new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
      server.closeAllConnections()
      for (const socket of sockets) socket.destroy()
      return closing
    },
  }
}

export function startPlexSseResponse(response: ServerResponse): PlexSseConnection {
  let closed = false
  let markClosed!: () => void
  const closedPromise = new Promise<void>(resolve => { markClosed = resolve })
  response.once('close', () => {
    closed = true
    markClosed()
  })
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
  return {
    get closed() { return closed },
    closedPromise,
    write(chunk) {
      if (!closed && !response.writableEnded) response.write(chunk)
    },
    end() {
      if (!closed && !response.writableEnded) response.end()
    },
  }
}

export function sseEvent(event: string, data: unknown, lineEnding = '\n'): string {
  return `event: ${event}${lineEnding}data: ${JSON.stringify(data)}${lineEnding}${lineEnding}`
}

export function sendJson(
  response: ServerResponse,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(data)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(body)),
    ...headers,
  })
  response.end(body)
}

export function sendText(
  response: ServerResponse,
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(body)),
    ...headers,
  })
  response.end(body)
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  if (await check()) return
  throw new Error(`Timed out waiting for ${description}`)
}
