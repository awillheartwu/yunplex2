import { success } from '../../lib/response'
import { getQueueStatus } from '../../lib/download/queue'

export default defineEventHandler(() => {
  return success(getQueueStatus())
})
