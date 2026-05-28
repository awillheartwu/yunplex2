import { subscribe, ping } from '../../lib/sync/events'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'text/event-stream')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')
  setResponseHeader(event, 'X-Accel-Buffering', 'no')

  event.node.res.write(':ok\n\n')

  const handler = (syncEvent: { type: string; data: Record<string, unknown> }) => {
    event.node.res.write(`event: ${syncEvent.type}\ndata: ${JSON.stringify(syncEvent.data)}\n\n`)
  }

  const unsubscribe = subscribe(handler)

  // Keep-alive every 30s to prevent proxy timeout and zombie cleanup
  const keepAlive = setInterval(() => {
    try {
      ping(handler)
      event.node.res.write(':ping\n\n')
    } catch { /* connection gone */ }
  }, 30000)

  event.node.req.on('close', () => {
    clearInterval(keepAlive)
    unsubscribe()
    event.node.res.end()
  })
})
