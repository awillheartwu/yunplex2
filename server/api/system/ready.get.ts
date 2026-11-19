import { getReadiness } from '../../lib/runtime/readiness'
export default defineEventHandler(event => {
  const result = getReadiness()
  setHeader(event, 'Cache-Control', 'no-store')
  if (!result.ready) setResponseStatus(event, 503)
  return { code: result.ready ? 0 : 1, msg: result.ready ? 'ok' : 'Service not ready', data: result }
})
