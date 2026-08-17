import { describe, expect, it } from 'vitest'
import { isGlobalSyncMode, resolveSyncModePolicy } from './mode-policy'

describe('sync mode policy', () => {
  it.each([
    ['normal', false, false, false, false],
    ['preview', true, false, false, false],
    ['full', false, true, false, false],
    ['rebuild_matching', false, true, true, false],
    ['redownload_managed', false, true, false, true],
  ] as const)('maps %s without boolean combinations', (mode, dryRun, forceFullCompare, rebuild, redownload) => {
    expect(resolveSyncModePolicy(mode)).toEqual({
      dryRun,
      forceFullCompare,
      rebuildAutomaticBindings: rebuild,
      redownloadManagedMedia: redownload,
    })
  })

  it('restricts global runs to modes that do not require a source', () => {
    expect(isGlobalSyncMode('normal')).toBe(true)
    expect(isGlobalSyncMode('preview')).toBe(true)
    expect(isGlobalSyncMode('full')).toBe(true)
    expect(isGlobalSyncMode('rebuild_matching')).toBe(false)
    expect(isGlobalSyncMode('redownload_managed')).toBe(false)
  })
})
