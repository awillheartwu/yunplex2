import { success } from '../../lib/response'
import { getSyncServiceInstance } from '../../lib/sync/instance'

export default defineEventHandler(() => {
  const syncService = getSyncServiceInstance()
  return success(syncService.getState())
})
