import { success } from '../../lib/response'

export default defineEventHandler(() => {
  return success({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})
