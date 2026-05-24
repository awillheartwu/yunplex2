import { getSyncService } from './service'
import type { startWorker } from './worker'

let syncService: ReturnType<typeof getSyncService> | null = null
let syncWorker: ReturnType<typeof startWorker> | null = null

export function setSyncService(s: ReturnType<typeof getSyncService>) {
  syncService = s
}

export function getSyncServiceInstance() {
  if (!syncService) {
    throw new Error('Sync service not initialized')
  }
  return syncService
}

export function setSyncWorker(w: ReturnType<typeof startWorker>) {
  syncWorker = w
}

export function getSyncWorker() {
  return syncWorker
}
