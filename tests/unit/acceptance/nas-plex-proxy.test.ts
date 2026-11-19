import http, { type RequestListener, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlexProxy } from '../../acceptance/nas-plex-proxy.mjs'

const resources: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const dispose of resources.reverse()) await dispose()
  resources.length = 0
})

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  resources.push(() => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  }))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  return `http://127.0.0.1:${address.port}`
}

async function fixture(handler: RequestListener) {
  const control = mkdtempSync(join(tmpdir(), 'yunplex-proxy-unit-'))
  resources.push(() => rmSync(control, { recursive: true, force: true }))
  const upstream = await listen(http.createServer(handler))
  writeFileSync(join(control, 'upstream.json'), JSON.stringify({ url: upstream }))
  const proxy = await listen(createPlexProxy(control))
  return { control, proxy }
}

function open(url: string, method = 'GET') {
  const request = http.request(url, { method })
  request.on('error', () => undefined)
  resources.push(() => { request.destroy() })
  request.end()
  return request
}

describe('NAS acceptance Plex proxy', () => {
  it('forwards a live notification before upstream ends and releases it on disconnect', async () => {
    let upstreamClosed = false
    const { proxy } = await fixture((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('event: timeline\ndata: {"state":5}\n\n')
      res.on('close', () => { upstreamClosed = true })
    })
    const request = open(`${proxy}/:/eventsource/notifications`)
    let received = ''
    request.on('response', response => response.on('data', chunk => { received += chunk }))
    await vi.waitFor(() => expect(received).toContain('event: timeline'), { timeout: 2000 })
    request.destroy()
    await vi.waitFor(() => expect(upstreamClosed).toBe(true), { timeout: 2000 })
  })

  it('cancels an upstream subscription even before response headers arrive', async () => {
    let upstreamOpened = false, upstreamClosed = false
    const { proxy } = await fixture((req, _res) => {
      upstreamOpened = true
      req.on('close', () => { upstreamClosed = true })
    })
    const request = open(`${proxy}/:/eventsource/notifications`)
    await vi.waitFor(() => expect(upstreamOpened).toBe(true), { timeout: 2000 })
    request.destroy()
    await vi.waitFor(() => expect(upstreamClosed).toBe(true), { timeout: 2000 })
  })

  it.each(['hold_insert_before', 'hold_insert_response'])('preserves the %s write interruption boundary', async mode => {
    let forwarded = 0, responded = false
    const { control, proxy } = await fixture((_req, res) => {
      forwarded++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"accepted":true}')
    })
    writeFileSync(join(control, 'fault.json'), JSON.stringify({ mode, playlistKey: 'fixture', nonce: 'nonce' }))
    const request = open(`${proxy}/playlists/fixture/items`, 'PUT')
    request.on('response', () => { responded = true })
    let reached: { phase: string; nonce: string } | undefined
    await vi.waitFor(() => {
      reached = JSON.parse(readFileSync(join(control, 'fault-reached.json'), 'utf8'))
      expect(reached?.nonce).toBe('nonce')
    }, { timeout: 2000 })
    expect(reached?.phase).toBe(mode === 'hold_insert_before' ? 'not_forwarded' : 'upstream_committed_response_held')
    expect(forwarded).toBe(mode === 'hold_insert_before' ? 0 : 1)
    expect(responded).toBe(false)
  })
})
