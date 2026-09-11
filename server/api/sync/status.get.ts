import { success } from '../../lib/response'
import { getSyncServiceInstance, isRepairRunning } from '../../lib/sync/instance'

export default defineEventHandler(() => {
  const syncService = getSyncServiceInstance()
  const state = syncService.getState()
  return success(isRepairRunning() ? { ...state, currentStage: 'repair' as const } : state)
})
