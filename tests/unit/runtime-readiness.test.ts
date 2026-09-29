import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ database: true, setup: false, worker: true, download: 'ready' }))
vi.mock('../../server/lib/db', () => ({ getDb: () => { if (!state.database) throw new Error('private error'); return { prepare: () => ({ get: () => ({}) }) } } }))
vi.mock('../../server/lib/auth/store', () => ({ getSetupState: () => ({ completed: state.setup }) }))
vi.mock('../../server/lib/sync/instance', () => ({ getSyncWorker: () => state.worker ? {} : null }))
vi.mock('../../server/lib/download/worker', () => ({ getDownloadWorker: () => ({ getStatus: () => state.download }) }))
import { getReadiness, setRuntimePhase } from '../../server/lib/runtime/readiness'
beforeEach(() => { Object.assign(state, { database: true, setup: false, worker: true, download: 'ready' }); setRuntimePhase('ready') })
it('keeps the setup wizard ready without external credentials', () => {
  expect(getReadiness()).toEqual({ ready: true, status: 'setup_required' })
  state.setup = true; expect(getReadiness()).toEqual({ ready: true, status: 'ready' })
})
it('fails closed on database, consumer, startup and shutdown failures without diagnostics', () => {
  state.database = false; expect(getReadiness()).toEqual({ ready: false, status: 'not_ready' })
  state.database = true; state.download = 'failed'; expect(getReadiness().ready).toBe(false)
  state.download = 'ready'; state.worker = false; expect(getReadiness().ready).toBe(false)
  state.worker = true; setRuntimePhase('stopping'); expect(getReadiness().ready).toBe(false)
})
