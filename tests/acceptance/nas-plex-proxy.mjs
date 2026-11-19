// A scoped fault injector. Never logs request queries, headers or response bodies.
import http from 'node:http'
import https from 'node:https'
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function createPlexProxy(control = '/control') {
  const upstream = JSON.parse(readFileSync(`${control}/upstream.json`, 'utf8'))
  function read(name) {
    return existsSync(`${control}/${name}.json`) ? JSON.parse(readFileSync(`${control}/${name}.json`, 'utf8')) : {}
  }
  function reached(fault, phase) {
    const result = { nonce: fault.nonce, mode: fault.mode, phase, at: new Date().toISOString() }
    writeFileSync(`${control}/fault-reached.tmp`, JSON.stringify(result), { mode: 0o600 })
    renameSync(`${control}/fault-reached.tmp`, `${control}/fault-reached.json`)
  }
  return http.createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    const fault = read('fault')
    const hit = req.method === 'PUT' && path === `/playlists/${fault.playlistKey}/items`
    if (hit && fault.mode === 'hold_insert_before') {
      reached(fault, 'not_forwarded')
      req.resume()
      return
    }
    const target = new URL(req.url, upstream.url)
    const transport = target.protocol === 'https:' ? https : http
    let upstreamResponse
    const request = transport.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, response => {
      upstreamResponse = response
      const hold = hit && fault.mode === 'hold_insert_response' && response.statusCode >= 200 && response.statusCode < 300
      response.on('end', () => {
        if (['POST', 'PUT', 'DELETE'].includes(req.method) && path.startsWith('/playlists')) {
          appendFileSync(`${control}/proxy-mutations.jsonl`, `${JSON.stringify({ at: Date.now(), method: req.method, path, status: response.statusCode })}\n`, { mode: 0o600 })
        }
        if (hold) reached(fault, 'upstream_committed_response_held')
      })
      response.on('error', () => res.destroy())
      if (hold) { response.resume(); return }
      // Plex notifications never end. Stream with backpressure instead of retaining chunks.
      res.writeHead(response.statusCode, response.headers)
      res.flushHeaders()
      response.pipe(res)
    })
    const cancel = () => { request.destroy(); upstreamResponse?.destroy() }
    res.on('close', cancel)
    req.on('aborted', cancel)
    request.on('error', () => {
      if (res.destroyed) return
      if (res.headersSent) { res.destroy(); return }
      res.writeHead(502)
      res.end()
    })
    req.pipe(request)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) createPlexProxy().listen(3010, '127.0.0.1')
