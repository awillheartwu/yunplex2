import { getDb } from '../db'
import { getSetupState } from '../auth/store'
import { getDownloadWorker } from '../download/worker'
import { getSyncWorker } from '../sync/instance'

export type RuntimePhase = 'starting' | 'ready' | 'stopping' | 'stopped'
let phase: RuntimePhase = 'starting'
export function setRuntimePhase(value: RuntimePhase) { phase = value }
export function getReadiness() {
  try {
    getDb().prepare('SELECT 1').get()
    const setupRequired = !getSetupState().completed
    const ready = phase === 'ready' && !!getSyncWorker() && getDownloadWorker()?.getStatus() === 'ready'
    return { ready, status: ready ? (setupRequired ? 'setup_required' : 'ready') : 'not_ready' }
  } catch {
    return { ready: false, status: 'not_ready' }
  }
}
