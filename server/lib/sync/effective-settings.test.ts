import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config/defaults'
import type { PlaylistSource } from '../playlist/types'
import { enablesMissingMediaPolicy, resolveEffectiveSourceSyncSettings } from './effective-settings'

function source(overrides: Partial<PlaylistSource> = {}): PlaylistSource {
  return {
    forceFullCompare: null,
    downloadWhenMediaMissing: null,
    skipPlexPlaylist: null,
    skipRemoveExtraTracks: null,
    fullCompareAfterSkips: null,
    fullCompareAfterDays: null,
    ...overrides,
  } as PlaylistSource
}

describe('effective source sync settings', () => {
  it('inherits global values when source overrides are null', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.sync.forceFullCompare = true
    config.sync.downloadWhenMediaMissing = true
    config.sync.skipRemoveExtraTracks = true

    expect(resolveEffectiveSourceSyncSettings(source(), config)).toMatchObject({
      forceFullCompare: true,
      downloadWhenMediaMissing: true,
      skipRemoveExtraTracks: true,
      fullCompareAfterSkips: config.sync.fullCompareAfterSkips,
    })
  })

  it('allows a source to explicitly disable a globally enabled option', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.sync.forceFullCompare = true
    config.sync.downloadWhenMediaMissing = true
    config.sync.skipRemoveExtraTracks = true

    expect(resolveEffectiveSourceSyncSettings(source({
      forceFullCompare: false,
      downloadWhenMediaMissing: false,
      skipRemoveExtraTracks: false,
    }), config)).toMatchObject({
      forceFullCompare: false,
      downloadWhenMediaMissing: false,
      skipRemoveExtraTracks: false,
    })
  })

  it('marks only effective off-to-on source transitions for reconciliation', () => {
    expect(enablesMissingMediaPolicy(null, true, false)).toBe(true)
    expect(enablesMissingMediaPolicy(false, null, true)).toBe(true)
    expect(enablesMissingMediaPolicy(null, false, true)).toBe(false)
    expect(enablesMissingMediaPolicy(true, true, false)).toBe(false)
    expect(enablesMissingMediaPolicy(false, undefined, true)).toBe(false)
  })
})
