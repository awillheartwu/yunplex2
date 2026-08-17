import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../config/types'
import { cloneConfig } from '../config/validation'
import { DEFAULT_CONFIG } from '../config/defaults'
import { startWorker, stopWorker } from './worker'

function makeConfig(overrides: Partial<AppConfig['sync']> = {}): AppConfig {
  const config = cloneConfig(DEFAULT_CONFIG)
  config.sync = { ...config.sync, ...overrides }
  return config
}

function makeService() {
  return {
    getState: vi.fn(() => ({ isRunning: false })),
    runSync: vi.fn(async () => ({ isRunning: false }) as any),
    cancelSync: vi.fn(() => false),
  }
}

describe('sync worker scheduling', () => {
  afterEach(() => {
    stopWorker()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stops the timer when auto sync is disabled through update', async () => {
    vi.useFakeTimers()
    let config = makeConfig({ enabled: true, intervalMinutes: 1 })
    const service = makeService()

    const worker = startWorker(() => config, service, './data')
    expect(worker.isScheduled()).toBe(true)

    config = makeConfig({ enabled: false, intervalMinutes: 1 })
    worker.update()

    expect(worker.isScheduled()).toBe(false)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(service.runSync).not.toHaveBeenCalled()
  })

  it('starts scheduling when auto sync is enabled through update', async () => {
    vi.useFakeTimers()
    let config = makeConfig({ enabled: false, intervalMinutes: 1 })
    const service = makeService()

    const worker = startWorker(() => config, service, './data')
    expect(worker.isScheduled()).toBe(false)

    config = makeConfig({ enabled: true, intervalMinutes: 1 })
    worker.update()

    expect(worker.isScheduled()).toBe(true)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(service.runSync).toHaveBeenCalledWith({ mode: 'normal', trigger: 'schedule' })
  })

  it('rechecks the latest enabled flag before running scheduled sync', async () => {
    vi.useFakeTimers()
    let config = makeConfig({ enabled: true, intervalMinutes: 1 })
    const service = makeService()

    const worker = startWorker(() => config, service, './data')
    config = makeConfig({ enabled: false, intervalMinutes: 1 })

    await vi.advanceTimersByTimeAsync(61_000)

    expect(service.runSync).not.toHaveBeenCalled()
    expect(worker.isScheduled()).toBe(false)
  })
})
